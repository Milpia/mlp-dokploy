---
description: "Task list for 001-keycloak-sso"
---

# Tasks: SSO con Keycloak para la edición free

**Input**: Design documents from `/specs/001-keycloak-sso/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Son **obligatorias**, por NFR-QA-001/002 y el principio IV de la constitución. En
autenticación, las pruebas de denegación se escriben antes que la implementación y deben
fallar primero.

**Organization**: Las tareas se agrupan por user story. US1 y US3 son P1; US2 y US4 son P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: US1–US4 según spec.md.
- Rutas relativas a la raíz del repositorio. Las pruebas viven en
  `apps/dokploy/__test__/keycloak-sso/`; el dominio, en `packages/server/src/keycloak-sso/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencias y esqueleto del módulo.

- [ ] T001 Add `openid-client` ^6 to `packages/server/package.json` and `apps/dokploy/package.json` dependencies and update `pnpm-lock.yaml` with `pnpm install` (research R2)
- [ ] T002 [P] Add `@vitest/coverage-v8` (same major as vitest 4) to `apps/dokploy/package.json` devDependencies and a `coverage` block in `apps/dokploy/__test__/vitest.config.ts` limited to `packages/server/src/keycloak-sso/**` with thresholds lines 90 / branches 85 (NFR-QA-001)
- [ ] T003 [P] Create the module skeleton `packages/server/src/keycloak-sso/index.ts` and domain types in `packages/server/src/keycloak-sso/types.ts`: `SsoMode = "disabled" | "button" | "sso-only"`, `Role = "admin" | "member"`, `DenyReason`, `LoginErrorCode` (`keycloak_cancelled`, `keycloak_invalid_response`, `keycloak_email_unverified`, `keycloak_access_denied`, `keycloak_unavailable`, `keycloak_clock_skew`), `AuthEventType`, `AuthEventOutcome` (data-model.md, contracts/http-endpoints.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema, configuración efectiva, cliente OIDC, política de acceso y eventos, que
comparten todas las stories.

**⚠️ CRITICAL**: Ninguna story empieza hasta completar esta fase.

- [ ] T004 Create Drizzle tables in `packages/server/src/db/schema/keycloak-sso.ts`:
  - `keycloak_sso_config`: `mode` text default `disabled`; nullable `issuerUrl`, `clientId`, `clientSecret`, `accessGroup`, `adminGroup`; `buttonLabel` default `Sign in with Keycloak`; `allowInsecureHttp` boolean default false; `verifiedIssuer` and `verifiedAt` nullable; timestamps.
  - `keycloak_auth_event`: `type`, `outcome`, `reason`, `email`, `userId` (no FK), `ip`, `correlationId`, `createdAt`, with an index on `createdAt`.
  - Export it from `packages/server/src/db/schema/index.ts`.
- [ ] T005 Generate the additive migration with `pnpm --filter=dokploy run migration:generate` into `apps/dokploy/drizzle/` and verify it only contains `CREATE TABLE`/`CREATE INDEX` statements
- [ ] T006 [P] Write failing tests for env parsing in `apps/dokploy/__test__/keycloak-sso/config-env.test.ts`: every `KEYCLOAK_SSO_*` variable, `_FILE` secret, empty values treated as unset, invalid mode ignored (contracts/cli-and-env.md)
- [ ] T007 [P] Implement `readEnvOverrides()` in `packages/server/src/keycloak-sso/config/env.ts` to pass T006
- [ ] T008 [P] Write failing tests for pure domain rules in `apps/dokploy/__test__/keycloak-sso/access-policy.test.ts` (all R7 rules, incl. owner exemption, banned, no access group → provisioning disabled, admin group absent → role unchanged), `claims.test.ts` (group normalisation `/a/b` vs `b`, missing email, `email_verified` not true), `return-to.test.ts` (reject `//evil`, `/\\evil`, `https://`, `javascript:`, encoded variants, non-string; default `/dashboard/home`), `mode-transition.test.ts` (data-model transitions)
- [ ] T009 [P] Implement `decideAccess` in `packages/server/src/keycloak-sso/domain/access-policy.ts` (FR-006, FR-007, FR-007a, FR-008, FR-008b)
- [ ] T010 [P] Implement `extractIdentity` and `isInGroup` in `packages/server/src/keycloak-sso/domain/claims.ts` (research R6)
- [ ] T011 [P] Implement `sanitizeReturnTo` in `packages/server/src/keycloak-sso/domain/return-to.ts` (NFR-SEC-003)
- [ ] T012 [P] Implement `canTransitionMode` in `packages/server/src/keycloak-sso/domain/mode-transition.ts` (FR-011, data-model transitions)
- [ ] T013 Implement `ConfigRepository` in `packages/server/src/keycloak-sso/config/repository.ts`: single-row get/upsert, secret encrypted with `encryptValue`/`decryptValue` from `packages/server/src/lib/encryption.ts`, never returning the plaintext outside the module (FR-015)
- [ ] T014 Write failing tests in `apps/dokploy/__test__/keycloak-sso/config-provider.test.ts`:
  - env precedence and `sources` map (FR-019/020);
  - `active` false for incomplete, cloud or enterprise (R14);
  - env `sso-only` without verification degrades to `button`;
  - 5 s TTL and immediate `invalidate()` (NFR-PERF-005);
  - one DB read for N concurrent calls.
- [ ] T015 Implement `KeycloakConfigProvider` in `packages/server/src/keycloak-sso/config/provider.ts` to pass T014
- [ ] T016 [P] Write failing tests in `apps/dokploy/__test__/keycloak-sso/oidc-client.test.ts`:
  - client cached per config fingerprint;
  - 5 s timeout mapped to `keycloak_unavailable` (NFR-PERF-004);
  - `allowInsecureHttp` required for `http:` (NFR-SEC-004);
  - error mapping for state mismatch, invalid ID token and clock skew.
- [ ] T017 Implement `OidcClient` port and `openid-client` adapter in `packages/server/src/keycloak-sso/oidc/client.ts`. It covers:
  - discovery;
  - `buildAuthorizationUrl` with S256 PKCE, `state` and `nonce`;
  - `exchangeCode` via `authorizationCodeGrant` with expected state, nonce and ID token;
  - userinfo fallback for groups;
  - `buildEndSessionUrl`;
  - `testCredentials`.
- [ ] T018 [P] Implement `AuthEventRecorder` in `packages/server/src/keycloak-sso/events/auth-events.ts`: `record()` never throws (logs on failure), `listRecent(limit)`, 90-day retention pruning at most once per hour (research R12, FR-013)
- [ ] T019 Export the module's public API from `packages/server/src/keycloak-sso/index.ts` and `packages/server/src/index.ts`

**Checkpoint**: dominio, configuración y adaptadores listos y probados.

---

## Phase 3: User Story 1 - Iniciar sesión con el botón de Keycloak (Priority: P1) 🎯 MVP

**Goal**: En modo botón, el login de siempre muestra «Sign in with Keycloak»; el login
correcto lleva al panel y el login local sigue funcionando.

**Independent Test**: Configurar por variables de entorno (modo `button`) y seguir el
quickstart §2, pasos 5–8.

### Tests for User Story 1 ⚠️ (escribir primero, deben fallar)

- [ ] T020 [P] [US1] Write failing tests in `apps/dokploy/__test__/keycloak-sso/provisioning.test.ts`:
  - link by `sub`;
  - link by verified email when not yet linked;
  - create user + account + member in one transaction (rollback when the member insert fails);
  - role recalculated per login;
  - owner row never modified;
  - no owner → `no_owner`.
- [ ] T021 [P] [US1] Write failing tests in `apps/dokploy/__test__/keycloak-sso/endpoints.test.ts` with fake `OidcClient` and fake provisioning:
  - `sign-in` sets the signed tx cookie (HttpOnly, SameSite=Lax, 600 s) and redirects to the authorization URL;
  - `callback` maps every error to `/?error=<code>&ref=<id>`;
  - `callback` clears the tx cookie always;
  - `callback` creates a fresh session and redirects to the sanitised `returnTo`;
  - endpoints return 404 when not active.

### Implementation for User Story 1

- [ ] T022 [US1] Implement `provisionIdentity()` in `packages/server/src/keycloak-sso/identity/provisioning.ts` to pass T020: a Drizzle transaction over `user`, `account` (`providerId = "keycloak"`, `accountId = sub`, `idToken` only) and `member` in the owner's organization (research R8, R9, FR-006, FR-007, FR-008a)
- [ ] T023 [US1] Implement the `sign-in` and `callback` endpoints in `packages/server/src/keycloak-sso/plugin/endpoints.ts` using `createAuthEndpoint`, signed cookie `keycloak_sso_tx`, `internalAdapter.createSession` and `setSessionCookie`; record `sso_login` events with `correlationId` (contracts/http-endpoints.md, NFR-SEC-001/002/005/007, NFR-QA-004)
- [ ] T024 [US1] Implement `keycloakSso()` in `packages/server/src/keycloak-sso/plugin/index.ts` (endpoints plus `rateLimit` rule for `/keycloak/*` of 20 per 60 s) and register it in `packages/server/src/lib/auth.ts` plugins (NFR-SEC-006)
- [ ] T025 [US1] Implement `keycloakSso.publicConfig` in `apps/dokploy/server/api/routers/keycloak-sso.ts` and register the router in `apps/dokploy/server/api/root.ts` (contracts/trpc-keycloak-sso.md)
- [ ] T026 [P] [US1] Create `apps/dokploy/components/auth/sign-in-with-keycloak.tsx`: an outline button with the configured label linking to `/api/auth/keycloak/sign-in` (with `returnTo` when present) (FR-003)
- [ ] T027 [US1] Update `apps/dokploy/pages/index.tsx`:
  - prefetch `keycloakSso.publicConfig`;
  - render `SignInWithKeycloak` above the local form in `button` mode;
  - map `keycloak_*` error codes to clear messages that show the `ref` (acceptance US1-5, NFR-QA-004).
- [ ] T028 [US1] Run the US1 unit tests and `pnpm typecheck` for `packages/server` and `apps/dokploy`, and fix any failures

**Checkpoint**: US1 funciona con la configuración por variables de entorno.

---

## Phase 4: User Story 3 - Configurar la conexión y elegir el modo (Priority: P1)

**Goal**: El owner configura Keycloak desde la interfaz, prueba la conexión y elige el modo;
los valores que vienen del entorno aparecen bloqueados.

**Independent Test**: quickstart §2, pasos 1–4, y §5.

### Tests for User Story 3 ⚠️

- [ ] T029 [P] [US3] Write failing tests in `apps/dokploy/__test__/keycloak-sso/router.test.ts`:
  - non-owner gets `FORBIDDEN`;
  - `get` never returns the secret, only `hasClientSecret`;
  - `update` rejects env-sourced fields, `http:` without the flag, incomplete configuration for `button`/`sso-only`, `sso-only` without verification, and an `issuerUrl` change while in `sso-only`;
  - `update` invalidates the cache and records an event;
  - `testConnection` maps failures to `TestFailure` codes.

### Implementation for User Story 3

- [ ] T030 [US3] Implement the `get`, `update`, `testConnection` and `listEvents` owner-only procedures in `apps/dokploy/server/api/routers/keycloak-sso.ts` using a shared `ownerProcedure` guard (`ctx.user.role === "owner"`) and `IS_CLOUD` → `NOT_FOUND` (FR-001, FR-014, FR-015, FR-018, FR-020)
- [ ] T031 [US3] Record the owner's successful Keycloak login as verification (`verifiedIssuer`, `verifiedAt`) inside the callback flow in `packages/server/src/keycloak-sso/plugin/endpoints.ts` (FR-011)
- [ ] T032 [P] [US3] Create `apps/dokploy/components/dashboard/settings/keycloak-sso/keycloak-sso-settings.tsx`:
  - form built with react-hook-form and zod;
  - a secret field that is write-only;
  - the callback URL with a copy button;
  - a mode selector that explains why `sso-only` is disabled when unverified;
  - a warning banner when HTTP is allowed;
  - env-sourced fields disabled with a "from environment" badge;
  - a role-overwrite warning (FR-008c);
  - a "Test connection" action.
- [ ] T033 [P] [US3] Create `apps/dokploy/components/dashboard/settings/keycloak-sso/keycloak-auth-events.tsx` listing the last 50 events
- [ ] T034 [US3] Create the page `apps/dokploy/pages/dashboard/settings/keycloak-sso.tsx` (owner only, not cloud, same `getServerSideProps` guard pattern as other settings pages) and add the sidebar entry in `apps/dokploy/components/layouts/side.tsx`

**Checkpoint**: US1 + US3 = MVP completo y configurable.

---

## Phase 5: User Story 2 - Acceso directo en modo SSO-only (Priority: P2)

**Goal**: Sin sesión, cualquier URL lleva a Keycloak y vuelve a la página pedida; el login
local queda cerrado; el logout cierra también la sesión de Keycloak.

**Independent Test**: quickstart §3.

### Tests for User Story 2 ⚠️

- [ ] T035 [P] [US2] Write failing tests in `apps/dokploy/__test__/keycloak-sso/sso-only-guard.test.ts`:
  - in `sso-only`, block sign-up, social, passkey and password-reset paths with 403;
  - allow `/sign-in/email` only for the owner's email (case-insensitive);
  - in `button`/`disabled`, never interfere (FR-009).
- [ ] T036 [P] [US2] Write failing tests in `apps/dokploy/__test__/keycloak-sso/sign-out.test.ts`:
  - `sso-only` redirects to the end-session URL with `id_token_hint`, `client_id` and `post_logout_redirect_uri`;
  - `button` redirects to `/`;
  - the local session is always deleted (FR-010).
- [ ] T037 [P] [US2] Write failing tests in `apps/dokploy/__test__/keycloak-sso/proxy.test.ts`: `/dashboard/*` without a session cookie redirects to `/?returnTo=<path+query>`; with a cookie it passes through; other paths pass through.

### Implementation for User Story 2

- [ ] T038 [US2] Implement the SSO-only guard (`hooks.before`) in `packages/server/src/keycloak-sso/plugin/sso-only-guard.ts` and wire it in the plugin (FR-009, FR-012)
- [ ] T039 [US2] Implement the `sign-out` endpoint in `packages/server/src/keycloak-sso/plugin/endpoints.ts` (FR-010)
- [ ] T040 [US2] Create `apps/dokploy/proxy.ts` with matcher `/dashboard/:path*` using `getSessionCookie` from `better-auth/cookies` (research R10)
- [ ] T041 [US2] Update `getServerSideProps` in `apps/dokploy/pages/index.tsx`: in `sso-only` without session, `error` or `emergency`, redirect to `/api/auth/keycloak/sign-in?returnTo=<sanitised>`; when `error` is present, render the error with a "Retry" link instead of redirecting (FR-004, FR-016)
- [ ] T042 [US2] Update logout in `apps/dokploy/components/layouts/user-nav.tsx`: when `publicConfig.mode === "sso-only"`, navigate to `/api/auth/keycloak/sign-out` instead of `authClient.signOut()`

**Checkpoint**: US2 funciona sin romper US1 y US3.

---

## Phase 6: User Story 4 - Recuperar el acceso (Priority: P2)

**Goal**: Ruta web de emergencia solo para el owner y comando en el servidor, ambos
registrados.

**Independent Test**: quickstart §4.

### Tests for User Story 4 ⚠️

- [ ] T043 [P] [US4] Write failing tests in `apps/dokploy/__test__/keycloak-sso/emergency.test.ts`:
  - `emergency_login` events for accepted and rejected attempts (`hooks.after` outcome);
  - the disable command switches `sso-only` → `button`, reports "nothing to do", and exits 2 with a warning when `KEYCLOAK_SSO_MODE=sso-only` (contracts/cli-and-env.md, FR-012a, FR-021).

### Implementation for User Story 4

- [ ] T044 [US4] Add `hooks.after` on `/sign-in/email` in `packages/server/src/keycloak-sso/plugin/sso-only-guard.ts` to record owner emergency logins (FR-013)
- [ ] T045 [US4] Implement `disableSsoOnlyMode()` in `packages/server/src/keycloak-sso/config/provider.ts` and the CLI in `apps/dokploy/scripts/keycloak-sso-disable-sso-only.ts`; add the esbuild entry in `apps/dokploy/esbuild.config.ts` and the `keycloak:disable-sso-only` script in `apps/dokploy/package.json` (FR-012a)
- [ ] T046 [US4] Show the emergency banner ("Emergency access — only the instance owner can sign in here") on `/?emergency=1` in `apps/dokploy/pages/index.tsx` (FR-012)

**Checkpoint**: todas las stories funcionan.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T047 [P] Add a benchmark in `apps/dokploy/__test__/keycloak-sso/performance.bench.ts` for the guard hook with the SSO disabled (target ≤ 5 ms p95, NFR-PERF-001) and for callback processing with a fake OIDC (target ≤ 300 ms p95, NFR-PERF-002)
- [ ] T048 [P] Add the e2e realm `apps/dokploy/__test__/keycloak-sso/e2e/realm-dokploy-test.json` and the opt-in e2e suite `apps/dokploy/__test__/keycloak-sso/e2e/keycloak.e2e.test.ts`, gated by `KEYCLOAK_E2E=1`, covering the acceptance scenarios and 50 concurrent logins (NFR-QA-002, NFR-PERF-006, SC-008)
- [ ] T049 [P] Write the operator guide in `specs/001-keycloak-sso/operations.md`: Keycloak client, redirect URI, Group Membership mapper, env vars, emergency procedures (NFR-QA-005)
- [ ] T050 Run `pnpm format-and-lint`, `pnpm typecheck` and the full `pnpm test`, plus coverage for the module, and fix issues (NFR-QA-001, NFR-QA-003)
- [ ] T051 Run a security review of the branch diff (`/security-review` equivalent) against research R16 and fix findings (NFR-SEC-008/009, SC-007)
- [ ] T052 Update `specs/001-keycloak-sso/traceability.yaml` with the FR/NFR → task → test → commit mapping (local only, `jira: null` until `/sdd-sync`)

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (1) → Foundational (2) → US1 (3) → US3 (4) → US2 (5) → US4 (6) → Polish (7).
- US3 depends on US1's router file (T025) and callback (T023).
- US2 depends on the plugin (T024) and `publicConfig` (T025).
- US4 depends on the SSO-only guard (T038).

### Within Each Story

Tests → dominio o adaptadores → endpoints → UI. Las pruebas de denegación, antes que la
implementación.

### Parallel Opportunities

- T002, T003 en paralelo tras T001.
- T006–T012: los tests y las funciones puras son archivos independientes.
- T016 y T018 en paralelo con T013–T015.
- En US1: T020, T021 y T026 en paralelo.
- En US3: T032 y T033 en paralelo.
- En US2: T035–T037 en paralelo.
- En Polish: T047–T049 en paralelo.

## Parallel Example: User Story 1

```bash
Task: "T020 provisioning tests in apps/dokploy/__test__/keycloak-sso/provisioning.test.ts"
Task: "T021 endpoint tests in apps/dokploy/__test__/keycloak-sso/endpoints.test.ts"
Task: "T026 SignInWithKeycloak button in apps/dokploy/components/auth/sign-in-with-keycloak.tsx"
```

## Implementation Strategy

### MVP First

Phases 1–4: US1 + US3. Con eso, cualquier instancia puede ofrecer el botón de Keycloak y
configurarlo desde la interfaz.

### Incremental Delivery

1. MVP (US1 + US3) → demo del modo botón.
2. US2 → modo SSO-only.
3. US4 → emergencias. **SSO-only no debe desplegarse en producción sin US4.**
4. Polish → e2e, benchmarks, guía de operación y revisión de seguridad.

## Notes

- Commits por task o grupo lógico, con trailers `Spec: 001-keycloak-sso`, `Requirement:` y
  `Task:`. El trailer `Jira:` se omite hasta que `/sdd-sync` cree las claves reales: poner
  claves inventadas rompería la detección de Jira. `traceability.yaml` lleva `jira: null`
  mientras tanto.
- Nada de push ni de cambios en Jira hasta la revisión del usuario.
