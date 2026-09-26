---
description: "Task list for 003-emergency-origin"
---

# Tasks: Origen permitido para el acceso de emergencia por túnel

**Input**: Design documents from `/specs/003-emergency-origin/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Son **obligatorias** por el principio IV. Esta funcionalidad relaja a propósito una
protección CSRF, así que las pruebas de los casos en que la petición **no** debe tocarse se
escriben antes que la implementación y deben fallar primero.

**Organization**: Las tareas se agrupan por user story. US1 y US2 son P1; US3 es P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: US1–US3 según spec.md.
- Rutas relativas a la raíz del repositorio:
  - pruebas: `apps/dokploy/__test__/oidc-sso/`;
  - dominio: `packages/server/src/oidc-sso/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Esquema.

- [X] T001 Add `emergency_origin` to `oidc_sso_auth_event` in `packages/server/src/db/schema/oidc-sso.ts` ("boolean, no nula, por defecto `false`", data-model.md) and generate an additive migration in `apps/dokploy/drizzle/` with `pnpm --filter=dokploy run migration:generate` (FR-007). If `canary` already has a migration after `0197_lying_hitman.sql` (for example, spec 002's), rebase first and regenerate so this one comes last (MIL-433).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configuración validada, política pura y eventos. Lo usan todas las stories.

**⚠️ CRITICAL**: ninguna user story puede empezar hasta terminar esta fase.

- [X] T002 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/config-env.test.ts` for `SSO_OIDC_EMERGENCY_ORIGIN` (FR-001, FR-002, research R5):
  - Accepted: `http://localhost:3900`, `https://recovery.example.com`, `http://127.0.0.1:3000`.
  - Rejected, each leaving the value undefined and adding the error `OIDC SSO: SSO_OIDC_EMERGENCY_ORIGIN must be an exact http(s) origin without path or wildcards` to `env.errors`:
    - `http://localhost:3900/` (trailing slash);
    - `http://localhost:3900/x`;
    - `http://localhost:3900?a=1`;
    - `http://*.example.com`;
    - `ftp://host`;
    - `http://user:pass@host`;
    - `localhost:3900`.
  - An empty or whitespace-only value counts as undefined, with no error.
- [X] T003 Implement `emergencyOrigin` in `packages/server/src/oidc-sso/config/env.ts` (`EnvOverrideValues` and `readEnvOverrides`) to pass T002. Accept it only when `new URL(v)` parses, the protocol is `http:` or `https:`, `url.origin === v`, and there is no `*` (FR-002).
- [X] T004 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/emergency-origin-policy.test.ts` for the pure `decideEmergencyOrigin(input)`, covering every condition in research R3 (FR-003, FR-004, FR-005, FR-006, FR-009, NFR-SEC-002):
  - no configured origin → no rewrite;
  - method `GET` → no rewrite;
  - `Origin` differs by scheme, host or port → no rewrite;
  - no `Origin` but a `Referer` whose origin matches → rewrite;
  - neither header → no rewrite;
  - a path outside the four allowed ones (`/sign-up/email`, `/request-password-reset`, `/change-password`, `/organization/invite-member`) → no rewrite;
  - SSO-only inactive → no rewrite on all four paths;
  - `/sign-in/email` with the owner's email, trimmed and in any case → rewrite;
  - `/sign-in/email` with another email → `{ rewrite: false, recordDenied: true }`;
  - `/sign-in/email` with `ownerEmail: null` → no rewrite;
  - `/two-factor/verify-totp`, `/two-factor/verify-backup-code` and `/sign-out` → rewrite;
  - other `/two-factor/*` paths (`/two-factor/enable`, `/two-factor/disable`, `/two-factor/generate-backup-codes`) → no rewrite.
- [X] T005 Implement `decideEmergencyOrigin` and `EMERGENCY_ORIGIN_PATHS` in `packages/server/src/oidc-sso/domain/emergency-origin.ts` to pass T004, with the input and decision types of data-model.md (FR-004, FR-005, FR-009).
- [X] T006 [P] Add optional `emergencyOrigin` to `AuthEventInput`, to the store and to the `listEvents` output in `packages/server/src/oidc-sso/events/auth-events.ts`, with tests in `apps/dokploy/__test__/oidc-sso/auth-events.test.ts` and `db-adapters.test.ts`: it persists `true` and defaults to `false` (FR-007).

**Checkpoint**: la política y la configuración están probadas sin tocar better-auth.

---

## Phase 3: User Story 1 - El owner recupera el acceso por túnel con el proveedor de identidad caído (Priority: P1) 🎯 MVP

**Goal**: con SSO-only y la variable definida, el owner completa el login, el segundo factor y el
cierre de sesión desde el origen de emergencia, y cada intento queda marcado en los eventos.

**Independent Test**: a través de `auth.handler` real de better-auth, un `POST /api/auth/sign-in/email`
con `Origin: http://localhost:3900`, cookies ajenas y el email del owner responde 200 con cookie
de sesión. El mismo POST sin la funcionalidad responde 403 `INVALID_ORIGIN`.

### Tests for User Story 1 ⚠️

- [X] T007 [P] [US1] Write failing tests in `apps/dokploy/__test__/oidc-sso/emergency-origin-request.test.ts` for the `onRequest` adapter, using real `Request` objects (FR-004, FR-005, FR-007, FR-009, NFR-SEC-001, NFR-SEC-002):
  - When rewriting:
    - `Origin` becomes the public origin of `baseURL`;
    - `Referer` is removed;
    - `x-oidc-sso-emergency-origin: 1` is added;
    - method, URL, the other headers and the body are unchanged and still readable.
  - Paths are matched relative to `basePath` (`/api/auth`).
  - An incoming `x-oidc-sso-emergency-origin` header is always stripped, including when there is no rewrite.
  - If the config, the owner lookup or the body parse throws, the original request is returned untouched.
  - With the variable undefined, it returns `undefined` without calling any dependency.
- [X] T008 [P] [US1] Write failing integration tests in `apps/dokploy/__test__/oidc-sso/emergency-origin-auth.test.ts`. Build a real `betterAuth` like `endpoints.test.ts`: `memoryAdapter`, `emailAndPassword`, the `twoFactor` plugin, `baseURL: https://deploy.example.test`, `oidcSso()` in `sso-only`, and a `trustedOrigins` function that does not include localhost. Cover US1 scenarios 1, 2 and 4 (SC-001):
  - The owner signs in from `Origin: http://localhost:3900` while also sending an unrelated `Cookie`. This proves the router-level check of research R1 passes, not only the endpoint-level one.
  - An owner with TOTP completes `/two-factor/verify-totp`, and separately `/two-factor/verify-backup-code`, from that origin.
  - `/sign-out` from that origin ends the session.
  - The same sign-in without the variable → 403 `INVALID_ORIGIN`.

### Implementation for User Story 1

- [X] T009 [US1] Implement the `onRequest` adapter in `packages/server/src/oidc-sso/plugin/emergency-origin.ts` (research R2–R3) and register it as `onRequest` in `packages/server/src/oidc-sso/plugin/index.ts`. It:
  - reads `emergencyOrigin` from the env overrides held by `getOidcSsoServices()`;
  - reads the email from a `request.clone()` body, only for `/sign-in/email` when the origin already matches;
  - calls `decideEmergencyOrigin`;
  - returns `{ request }` with the rewritten copy, or nothing.
  It must pass T007 and T008 (FR-004, FR-005, FR-009, NFR-SEC-001).
- [X] T010 [US1] Mark successful and failed owner emergency logins with `emergencyOrigin: true` in the `after` hook of `packages/server/src/oidc-sso/plugin/sso-only-guard.ts` when the internal header is present. Add tests in `apps/dokploy/__test__/oidc-sso/sso-only-guard.test.ts` (FR-007, US1 scenario 3).
- [X] T011 [US1] Show «via emergency origin» for events with `emergencyOrigin` in `apps/dokploy/components/dashboard/settings/oidc-sso/sso-auth-events.tsx`, and return the field from `listEvents` in `apps/dokploy/server/api/routers/oidc-sso.ts`, with a router test in `apps/dokploy/__test__/oidc-sso/router.test.ts` (FR-007, US1 scenario 3).

**Checkpoint**: US1 es entregable por sí sola y desbloquea la prueba L5 de infra.

---

## Phase 4: User Story 2 - El origen de emergencia no abre nada más (Priority: P1)

**Goal**: desde el origen de emergencia se sigue rechazando todo lo demás, y los intentos de otros
usuarios quedan registrados.

**Independent Test**: con la variable definida, desde `http://localhost:3900`:
- un login de otro usuario, un registro, un restablecimiento de contraseña y un cambio de
  contraseña responden 403;
- en modo botón, también el login del owner responde 403.

### Tests for User Story 2 ⚠️

- [X] T012 [P] [US2] Add failing integration tests to `apps/dokploy/__test__/oidc-sso/emergency-origin-auth.test.ts` (US2 scenarios 1–3, FR-004, FR-006, SC-002, SC-003):
  - A non-owner sign-in from the emergency origin → 403, and one `emergency_login` / `denied` / `not_owner` event with `emergencyOrigin: true`.
  - From the emergency origin, 403 `INVALID_ORIGIN` on:
    - `/sign-up/email`;
    - `/request-password-reset`;
    - `/change-password` with the owner's session;
    - `/two-factor/disable`.
  - In `button` mode, and with SSO disabled, the owner's sign-in from that origin → 403.
  - A client-supplied `x-oidc-sso-emergency-origin` header neither bypasses anything nor sets the event flag.

### Implementation for User Story 2

- [X] T013 [US2] Record the `not_owner` denial in `packages/server/src/oidc-sso/plugin/emergency-origin.ts` when `decideEmergencyOrigin` returns `recordDenied`. Record email, IP (`getIp`) and `emergencyOrigin: true`, and leave the request untouched so better-auth rejects it. If recording fails, log the error and keep the request untouched. Pass T012 (FR-006, FR-007).

**Checkpoint**: US1 y US2 juntas cumplen las cuatro condiciones de infra.

---

## Phase 5: User Story 3 - Sin configuración, nada cambia (Priority: P2)

**Goal**: sin la variable, o con un valor inválido, el comportamiento es el de upstream y el owner
ve la configuración efectiva.

**Independent Test**: sin la variable, el login del owner desde `http://localhost:3900` da el mismo
403 que hoy, y las pruebas existentes de la spec 001 pasan sin cambios.

### Tests for User Story 3 ⚠️

- [X] T014 [P] [US3] Add tests (FR-003, US3 scenarios 1–2, SC-005):
  - In `apps/dokploy/__test__/oidc-sso/emergency-origin-auth.test.ts`: with an invalid value (`http://localhost:3900/`), the owner's sign-in from that origin → 403, and the error is logged once at startup.
  - In `apps/dokploy/__test__/oidc-sso/router.test.ts`: `oidcSso.get` returns `emergencyOrigin: null` without the variable and the configured value with it, and `update` does not accept it.

### Implementation for User Story 3

- [X] T015 [US3] Return `emergencyOrigin: string | null` from `oidcSso.get` in `apps/dokploy/server/api/routers/oidc-sso.ts`, read-only. Show it in the emergency section of `apps/dokploy/components/dashboard/settings/oidc-sso/oidc-sso-settings.tsx` as "Emergency origin: <value> (set by environment)", or "Not set". Pass T014 (FR-001, FR-003).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 [P] Add `onRequest` benchmarks to `apps/dokploy/__test__/oidc-sso/performance.test.ts` for three cases: no variable; variable set but a different origin; variable set on an emergency path. Assert ≤ 1 ms p95 added and no dependency calls in the first two, and attach the results to the PR (NFR-PERF-001, NFR-PERF-002).
- [X] T017 [P] Document `SSO_OIDC_EMERGENCY_ORIGIN` and the tunnel procedure (FR-001, FR-002, SC-001):
  - In `specs/001-keycloak-sso/operations.md`: `ssh -L 3900:127.0.0.1:3000`, open `http://localhost:3900/?emergency=1`, owner login with second factor, disable SSO-only if needed, sign out, close the tunnel. Also cover what is still rejected from that origin.
  - In `specs/001-keycloak-sso/contracts/cli-and-env.md`: the variable.
- [X] T018 Run `pnpm --filter=dokploy test`, `pnpm typecheck` and `pnpm format-and-lint` (FR-008, principle IV):
  - Coverage of `packages/server/src/oidc-sso/**` must stay ≥ 90 % lines, with 100 % branches of `domain/emergency-origin.ts` and `plugin/emergency-origin.ts`.
  - Confirm with `grep` that no new file imports anything under `/proprietary`.
- [ ] T019 Run `/security-review` on the branch, focused on the `Origin` rewrite (plan.md Complexity Tracking), and resolve HIGH/MEDIUM findings before the PR (principle III, NFR-SEC-001, NFR-SEC-002).
- [ ] T020 Run the quickstart.md manual scenarios 1–10 and record the results in the PR description. Then tell the infra session the PR number, so MIL-425's image and the L5 lab test can include it (SC-001–SC-005).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: sin dependencias.
- **Foundational (2)**: depende de T001 solo en T006. Bloquea todas las stories.
- **US1 (3)**: depende de la fase 2.
- **US2 (4)**: depende de T009, que es el adaptador donde se añade el registro.
- **US3 (5)**: depende de T003. Se puede hacer en paralelo con US1.
- **Polish (6)**: al final.

### Within Each Story

- Primero las pruebas, que deben fallar. Después la implementación.
- La política (T005) va antes que el adaptador (T009).
- T008 es la prueba que confirma, con better-auth real, la hipótesis de research R1/R2 (que
  `onRequest` va antes de la comprobación del router). Si falla por esa razón, hay que volver al
  plan antes de seguir.

### Parallel Opportunities

- Fase 2: T002, T004 y T006.
- US1: T007 y T008.
- US3 (T014 y T015) en paralelo con US1 una vez hecho T003.
- Polish: T016 y T017.

---

## Parallel Example: User Story 1

```text
Task: "T007 onRequest adapter tests in emergency-origin-request.test.ts"
Task: "T008 real better-auth integration tests in emergency-origin-auth.test.ts"
# then
Task: "T009 onRequest adapter + registration in the oidcSso plugin"
```

---

## Implementation Strategy

### MVP First

1. Fases 1 y 2.
2. Fase 3 (US1). Con esto, el owner ya puede recuperar el acceso por el túnel. Es lo que
   necesita la prueba L5 del laboratorio.
3. Fase 4 (US2), para confirmar que el origen no abre nada más. Tiene que estar antes del PR.

### Incremental Delivery

- **US1 + US2**: un solo PR a `canary`. No se publica una sin la otra, porque US2 es la garantía de
  seguridad de US1.
- **US3**: muestra la configuración en la interfaz y cubre valores inválidos.
- **Polish**: rendimiento, documentación, revisión de seguridad y validación manual. Después, avisar
  a infra.

---

## Notes

- Cada prueba cita en su nombre (`it("FR-004: ...")`) o en un comentario el requisito que cubre
  (principio IV).
- Commits por task o grupo lógico, con los trailers `Spec: 003-emergency-origin`, `Requirement:`,
  `Task:` y `Jira:`. La clave de Jira sale de `/sdd-sync`, que se ejecuta antes de implementar.
- Las specs 002 y 003 añaden cada una una migración. La segunda que se mergee regenera la suya
  (T001).
