---
description: "Task list for 004-oidc-provider-compatibility"
---

# Tasks: Compatibilidad verificada con siete proveedores OIDC

**Input**: Design documents from `/specs/004-oidc-provider-compatibility/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Son **obligatorias** por el principio IV. El cambio del módulo se prueba con pruebas unitarias escritas primero, que deben fallar. La verificación de cada proveedor es la batería e2e de FR-004.

**Organization**: Las tareas se agrupan por user story. US1 y US2 son P1; US3 es P2.
- **US1:** los proveedores que funcionan sin tocar el módulo (Keycloak, Authentik y Okta).
- **US2:** la matriz y la CI.
- **US3:** el cambio de la información de usuario y los proveedores que lo necesitan o entregan los grupos de otra forma (Zitadel, FusionAuth, Authelia y Auth0).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: US1–US3 según spec.md.
- Rutas relativas a la raíz del repositorio:
  - pruebas y entornos: `apps/dokploy/__test__/oidc-sso/providers/`;
  - scripts: `apps/dokploy/scripts/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencia, scripts y documentación de los secretos de prueba.

- [ ] T001 Add `playwright-core` to `apps/dokploy/package.json` devDependencies (research R3, the only new dependency, dev-only) and the scripts `"e2e:oidc": "tsx scripts/oidc-providers.ts"` and `"e2e:oidc:matrix": "tsx scripts/oidc-compat-matrix.ts"`. Update `pnpm-lock.yaml` with `pnpm install`, then check with `pnpm --filter=@dokploy/server build` and `pnpm typecheck` that nothing else changes (FR-013, plan.md upstream touch points).
- [ ] T002 [P] Write `apps/dokploy/__test__/oidc-sso/providers/README.md` (FR-008, FR-009, research R8):
  - how to run a verification;
  - that the client secrets, passwords and keys in `providers/<id>/` are fixed test values for ephemeral containers listening on `127.0.0.1` only;
  - that the SaaS credentials only live in environment variables.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tipos, resultados, harness, batería y runner comunes a todos los proveedores.

**⚠️ CRITICAL**: ningún proveedor puede verificarse hasta terminar esta fase.

- [ ] T003 [P] Create `apps/dokploy/__test__/oidc-sso/providers/types.ts` with the `ProviderId`, `ScenarioId`, `VerificationResult` (`schema: "oidc-compat/v1"`) and `ProviderDriver` types exactly as in data-model.md (FR-004, FR-014).
- [ ] T004 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/providers/results.test.ts` for the results writer (FR-008, FR-014, data-model rules):
  - «`status = passed` solo si ningún escenario tiene `failed`»;
  - «`not-applicable` solo se permite en `sign-out`»;
  - a `skipped` result carries `skippedReason` naming the missing variables;
  - every value of the SaaS variables in `contracts/runner-and-env.md` is redacted from `failures[].message` before writing;
  - the file lands at `specs/004-oidc-provider-compatibility/results/<id>.json`.
- [ ] T005 Implement `apps/dokploy/__test__/oidc-sso/providers/results.ts` (`buildResult`, `redact`, `writeResult`) to pass T004 (FR-008, FR-014).
- [ ] T006 Create `apps/dokploy/__test__/oidc-sso/providers/harness.ts`. Extract the in-memory Dokploy setup from `apps/dokploy/__test__/oidc-sso/e2e/keycloak.e2e.test.ts` (memory repository, provisioning store, events, `betterAuth` with `oidcSso()`) and add a `playwright-core` Chromium browser whose `page.route("http://localhost:3000/**")` answers through `auth.handler`, so Dokploy needs no server (research R3). Helpers (FR-004):
  - `configure(driver.moduleConfig(), mode)`;
  - `signIn(user)`, which calls `driver.login(page, user)` and returns the landing URL and the role;
  - `signOut()`;
  - `testConnection(secret)`.
- [ ] T007 Create `apps/dokploy/__test__/oidc-sso/providers/battery.e2e.test.ts`. It loads the driver for `OIDC_E2E_PROVIDER`, runs the eight scenarios of data-model.md with `harness.ts`, and records each outcome with `results.ts` (FR-004, FR-011):
  - `login-provisioning`, `admin-role`, `access-denied` and `role-change` (through `driver.moveUser`);
  - `sign-out`, which accepts the «sesión cerrada» screen when discovery has no `end_session_endpoint`;
  - `connection-test-ok` and `connection-test-bad`, where `connection-test-bad` must never report success;
  - `user-management-group`, recorded as `"pending"` until spec 002 exists.
  
  It is skipped unless `OIDC_E2E_PROVIDER` is set, so `pnpm test` never runs it (NFR-QA-002).
- [ ] T008 Implement the runner `apps/dokploy/scripts/oidc-providers.ts` following `contracts/runner-and-env.md` (FR-008, FR-009, NFR-QA-001):
  - `<id>|all`;
  - for self-hosted providers:
    - `docker compose -f providers/<id>/compose.yml up -d`;
    - wait for the discovery document with a 5-minute timeout;
    - run `providers/<id>/seed.ts` if present;
    - run Vitest on `battery.e2e.test.ts` with `OIDC_E2E_PROVIDER=<id>`;
    - always `docker compose down -v` in `finally`;
  - for SaaS: skip with the missing variable names when `driver.requiredEnv` is unset;
  - one output line per provider;
  - exit code 0/1/2;
  - elapsed time printed per provider.
- [ ] T009 [P] Add runner unit tests in `apps/dokploy/__test__/oidc-sso/providers/runner.test.ts` (SC-005). With `docker` and Vitest replaced by fakes:
  - `down -v` runs even when the battery throws;
  - SaaS without credentials yields `skipped` and exit 0;
  - one failed provider yields exit 1;
  - a missing Docker yields exit 2.

**Checkpoint**: la infraestructura común está probada. Falta el primer proveedor para validarla de extremo a extremo.

---

## Phase 3: User Story 1 - El owner conecta Dokploy a su proveedor (Keycloak, Authentik, Okta) (Priority: P1) 🎯 MVP

**Goal**: los tres proveedores que no necesitan el cambio del módulo quedan verificados y con guía.

**Independent Test**: `pnpm --filter=dokploy run e2e:oidc keycloak` y `e2e:oidc authentik` terminan en `passed`. Okta termina en `passed` si hay credenciales, y en `skipped` con las variables que faltan si no.

- [ ] T010 [P] [US1] Create `apps/dokploy/__test__/oidc-sso/providers/keycloak/` (research R2):
  - `compose.yml`: `quay.io/keycloak/keycloak:26.7.4 start-dev --import-realm`, port `127.0.0.1:8080`.
  - `realm.json`:
    - groups `dokploy-users`, `dokploy-admins` and `admins-mgmt`;
    - users `member`, `admin`, `outsider` and `manager`, with `firstName`/`lastName`, `emailVerified: true` and non-temporary passwords;
    - a confidential client with a fixed secret, the redirect URI `http://localhost:3000/api/auth/oidc/callback` and `post.logout.redirect.uris`;
    - an `oidc-group-membership-mapper` with `full.path=false` on the ID token, access token and userinfo.
  - `driver.ts`: selectors `#username`, `#password` and `#kc-login`, and `moveUser` through the admin REST API.
- [ ] T011 [US1] Run `pnpm --filter=dokploy run e2e:oidc keycloak` until it passes. This validates Phase 2 end to end. Commit `specs/004-oidc-provider-compatibility/results/keycloak.json` (FR-001, FR-004).
- [ ] T012 [P] [US1] Create `apps/dokploy/__test__/oidc-sso/providers/authentik/` (research R2, FR-002 edge case on `email_verified`):
  - `compose.yml`: `ghcr.io/goauthentik/server:2026.8.3` as `server` and `worker`, plus postgres, with `AUTHENTIK_BOOTSTRAP_PASSWORD`/`TOKEN`.
  - `blueprint.yaml`:
    - groups and users with passwords;
    - an `oauth2provider` that is confidential, has a fixed client, a strict redirect and `default-provider-authorization-implicit-consent`;
    - an application;
    - an `email` scope mapping returning `email_verified: True`.
  - `driver.ts`: the two-step flow (username, then password) through Playwright's shadow-DOM-piercing locators, and `moveUser` through `/api/v3/core/users/`.
- [ ] T013 [P] [US1] Create `apps/dokploy/__test__/oidc-sso/providers/okta/` (FR-008, NFR-SEC-001, research R2 and R4):
  - `seed.ts`: idempotent through the Okta Management API with `OKTA_E2E_ORG_URL`/`OKTA_E2E_API_TOKEN`. It creates if missing:
    - a web OIDC app with a groups claim filter (`Matches regex .*`, claim `groups`) and the redirect and post-logout URIs;
    - the three groups;
    - the four users with `OIDC_E2E_SAAS_PASSWORD`;
    - the memberships and the app assignment;
    - a password-only sign-on rule for the app.
  - `driver.ts`: `requiredEnv` and the identifier-first Sign-In Widget login.
- [ ] T014 [US1] Update the Keycloak, Authentik and Okta sections of `specs/001-keycloak-sso/operations.md` with every FR-002 item:
  - client, redirect and post-logout URIs;
  - scopes;
  - how groups and `email_verified` are sent (Authentik's scope mapping, Okta's groups filter and password-only policy);
  - claim and example values;
  - known limitations.
- [ ] T015 [US1] Run `e2e:oidc authentik`, plus `e2e:oidc okta` if credentials are available, and commit their `results/*.json` (FR-001, SC-001).

**Checkpoint**: US1 da tres proveedores verificados y el harness probado de extremo a extremo.

---

## Phase 4: User Story 2 - El equipo sabe con certeza qué está verificado (Priority: P1)

**Goal**: la matriz se genera a partir de los resultados y la CI semanal detecta regresiones.

**Independent Test**: se borra `results/keycloak.json`, se ejecuta `e2e:oidc keycloak` y luego `e2e:oidc:matrix`, y la fila vuelve con la versión y la fecha nuevas sin editar la tabla a mano.

- [ ] T016 [P] [US2] Write failing tests in `apps/dokploy/__test__/oidc-sso/providers/matrix.test.ts` for the generator (FR-010, FR-014):
  - one row per `ProviderId` in the data-model order;
  - a provider with no result file shows «no verificado»;
  - `not-applicable` on `sign-out` shows «pasa (sin fin de sesión en el proveedor)»;
  - `pending` shows «pendiente de la spec 002»;
  - `limitations.md` sections are embedded per provider;
  - version, date and environment columns.
- [ ] T017 [US2] Implement `apps/dokploy/scripts/oidc-compat-matrix.ts` to pass T016. Create `specs/004-oidc-provider-compatibility/limitations.md` with one section per provider, starting with «Authelia: sin RP-initiated logout (authelia#5057)» (FR-010, FR-014).
- [ ] T018 [P] [US2] Create `.github/workflows/milpia-oidc-providers.yml` (NFR-QA-003, research R7):
  - triggers: `workflow_dispatch` and `schedule` on Monday;
  - `permissions: contents: read`;
  - a matrix over `keycloak`, `authentik`, `zitadel`, `fusionauth` and `authelia`, with no SaaS providers;
  - each job: `pnpm install --frozen-lockfile`, then `pnpm --filter=dokploy exec playwright-core install --with-deps chromium`, then `pnpm --filter=dokploy run e2e:oidc <id>`, then upload `results/<id>.json` as an artifact;
  - it runs only in `Milpia/mlp-dokploy`.
- [ ] T019 [US2] Run `pnpm --filter=dokploy run e2e:oidc:matrix` and commit `specs/004-oidc-provider-compatibility/compatibility.md`. Link it from `specs/001-keycloak-sso/operations.md`, and make FR-022 in `specs/001-keycloak-sso/spec.md` point to spec 004 for the verified list (FR-010, FR-012).

**Checkpoint**: US1 y US2 juntas dan una matriz real y repetible.

---

## Phase 5: User Story 3 - Proveedores que entregan los grupos de otra forma (Priority: P2)

**Goal**: el cambio genérico de la información de usuario y los cuatro proveedores que lo necesitan o entregan los grupos de otra forma.

**Independent Test**: Zitadel, FusionAuth y Authelia terminan en `passed`, y también Auth0 si hay credenciales. Ninguno añade código de módulo específico de un proveedor (SC-006).

### Tests for User Story 3 ⚠️

- [ ] T020 [US3] Write failing tests in `apps/dokploy/__test__/oidc-sso/oidc-client.test.ts` (FR-005, NFR-PERF-001):
  - when the ID token lacks `email` and/or `email_verified`, `exchangeCode` fills them from userinfo;
  - claims present in the ID token are never overwritten by userinfo;
  - userinfo is not called when the ID token already has the groups claim, `email` and `email_verified`;
  - a userinfo `sub` different from the ID token's rejects the login with `sso_invalid_response`;
  - a userinfo timeout surfaces as a provider failure, never as «sin grupos».

### Implementation for User Story 3

- [ ] T021 [US3] Extend `exchangeCode` in `packages/server/src/oidc-sso/oidc/client.ts` to pass T020. Fetch userinfo once when any of the groups claim, `email` or `email_verified` is missing from the ID token, and fill only the missing ones. Map `openid-client`'s subject-mismatch error to `SsoLoginError("sso_invalid_response", ...)` (FR-005, NFR-SEC).
- [ ] T022 [P] [US3] Add Auth0 and FusionAuth to `apps/dokploy/components/dashboard/settings/oidc-sso/provider-presets.ts` (FR-003, research R2):
  - Auth0: issuer `https://<tenant>.auth0.com/`, groups claim `https://dokploy/groups`, no extra scopes, and a hint about the Post-Login Action;
  - FusionAuth: issuer `https://<host>`, groups claim `roles`, extra scope `email`, and a hint about application roles granted through groups.
  
  Also refresh the Authentik hint with the `email_verified` scope mapping.
- [ ] T023 [P] [US3] Create `apps/dokploy/__test__/oidc-sso/providers/zitadel/` (research R2):
  - `compose.yml`: `ghcr.io/zitadel/zitadel:v4.19.0 start-from-init`, plus `zitadel-login` and postgres, `ZITADEL_EXTERNALSECURE=false`, and `ZITADEL_FIRSTINSTANCE_*` writing a machine PAT to a mounted path.
  - `seed.ts`: with that PAT, create:
    - a project with roles `dokploy-users`, `dokploy-admins` and `admins-mgmt`, and «assert roles on authentication»;
    - an OIDC web app in `devMode` with the redirect and post-logout URIs, whose generated client secret it captures for the driver;
    - the four users, verified and with passwords, and their user grants;
    - a login policy that skips MFA setup.
  - `driver.ts`: the multi-step Login V2 flow, groups claim `urn:zitadel:iam:org:project:roles`, and the extra scope `urn:zitadel:iam:org:projects:roles`.
- [ ] T024 [P] [US3] Create `apps/dokploy/__test__/oidc-sso/providers/fusionauth/` (research R2):
  - `compose.yml`: `fusionauth/fusionauth-app:1.69.2`, postgres, `SEARCH_TYPE=database` and `FUSIONAUTH_APP_KICKSTART_FILE`.
  - `kickstart.json`:
    - an application with roles named like the groups, `oauthConfiguration` (fixed client secret, authorized redirect, logout URL);
    - groups carrying `roleIds`;
    - verified users with registrations, and group memberships.
  - `driver.ts`: the single-form login and groups claim `roles`.
  
  Confirm in `connection-test-ok` that FusionAuth's reply to the made-up code is classified as valid credentials. If not, add a regression test and fix the classification in `oidc/client.ts` (FR-011).
- [ ] T025 [P] [US3] Create `apps/dokploy/__test__/oidc-sso/providers/authelia/` (research R2 and R4):
  - `compose.yml`: `authelia/authelia:4.39.28`, published on `127.0.0.1:9091` as `https://auth.localtest.me:9091`.
  - `configuration.yml`:
    - `server.tls` with the per-run CA certificate;
    - file backend and SQLite;
    - one client with a fixed `$plaintext$` secret, scopes `openid email profile groups`, `consent_mode: implicit`, `authorization_policy: one_factor` and **no** `claims_policy`, so the userinfo path of T021 is exercised.
  - `users_database.yml`: argon2 hashes and groups.
  - `driver.ts`: the single-page form, plus `allowInsecureHttp: false`.
  
  In `apps/dokploy/scripts/oidc-providers.ts`, generate the per-run CA with `openssl` into a temp dir, mount it, set `NODE_EXTRA_CA_CERTS` for Vitest, and set `ignoreHTTPSErrors` for the browser.
- [ ] T026 [P] [US3] Create `apps/dokploy/__test__/oidc-sso/providers/auth0/` (FR-008, NFR-SEC-001, research R2):
  - `action.js`: a Post-Login Action setting `https://dokploy/groups` from `event.authorization.roles` on the ID token.
  - `seed.ts`: idempotent through the Management API with `AUTH0_E2E_DOMAIN`/`AUTH0_E2E_MGMT_CLIENT_ID`/`AUTH0_E2E_MGMT_CLIENT_SECRET`. It creates if missing:
    - a Regular Web App with callbacks and allowed logout URLs;
    - roles named like the groups;
    - the four users (`email_verified: true`, `OIDC_E2E_SAAS_PASSWORD`) and their role assignments;
    - the Action, deployed and bound to the post-login trigger.
  - `driver.ts`: `requiredEnv`, Universal Login (identifier, then password), and accepting the consent screen.
- [ ] T027 [US3] Add or refresh the Zitadel, FusionAuth, Authelia and Auth0 sections of `specs/001-keycloak-sso/operations.md` with every FR-002 item (FR-002). The notes to include:
  - Zitadel: project roles as groups;
  - FusionAuth: application roles through groups;
  - Authelia: groups and email only in userinfo, HTTPS and a dotted cookie domain, no end-session;
  - Auth0: the namespaced claim through an Action, and the logout toggle.
- [ ] T028 [US3] Run `e2e:oidc zitadel`, `fusionauth` and `authelia`, plus `auth0` if credentials are available. Record any limitation in `limitations.md`, regenerate the matrix and commit the results (FR-001, FR-007, SC-001).

**Checkpoint**: los siete proveedores quedan verificados, o con sus limitaciones documentadas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Run `/security-review` on the branch. Focus on the userinfo change (precedence, subject check) and the runner's credential redaction, then resolve HIGH/MEDIUM findings (principle III, FR-005, FR-008).
- [ ] T030 Run `pnpm typecheck`, `pnpm --filter=@dokploy/server build` (then restore `packages/server/package.json`), `pnpm format-and-lint` and the `oidc-sso` suite with coverage (principle IV, SC-006):
  - `oidc/client.ts` keeps ≥ 90 % lines, with 100 % of the new userinfo branches.
  - `grep` confirms that no provider name appears in `packages/server/src/oidc-sso/**`.
- [ ] T031 Validate `quickstart.md` sections 1–6 (SC-002, SC-003, SC-005):
  - time one operator following a guide on a clean instance;
  - trigger the CI workflow once by hand;
  - attach the matrix and timings to the PR;
  - tell the infra session that the verified provider list changed.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: sin dependencias.
- **Foundational (2)**: depende de T001. Bloquea todo lo demás.
- **US1 (3)**: depende de la fase 2. T011 (Keycloak en verde) valida el harness y debe ir antes que T015.
- **US2 (4)**: T016 y T017 dependen de T003. T019 necesita al menos un resultado (T011).
- **US3 (5)**:
  - T020 y T021 no dependen de ningún proveedor y se pueden adelantar.
  - T023–T026 dependen de la fase 2.
  - T025 depende también de T021, porque Authelia solo manda los claims en userinfo.
- **Polish (6)**: al final.

### Within Each Story

- Las pruebas del cambio del módulo van primero y deben fallar (T020 antes que T021).
- Cada proveedor sigue el orden semilla/entorno → conductor → ejecución → resultados.

### Parallel Opportunities

- Fase 2: T003, T004 y T009.
- US1: T010, T012 y T013, cada uno en su directorio.
- US3: T022, T023, T024, T025 y T026, cada uno en su directorio o archivo.
- US2 (T016–T018) en paralelo con US1, una vez hecho T003.

---

## Parallel Example: User Story 3

```text
Task: "T023 zitadel/ compose + seed + driver"
Task: "T024 fusionauth/ compose + kickstart + driver"
Task: "T025 authelia/ compose + config + driver (+ CA in runner)"
Task: "T026 auth0/ seed + action + driver"
```

---

## Implementation Strategy

### MVP First

1. Fases 1 y 2.
2. Keycloak en verde (T010–T011). Demuestra la batería común.
3. Authentik y Okta (US1), luego la matriz y la CI (US2).

### Incremental Delivery

- **PR 1:** fases 1–4. Tres proveedores verificados, matriz y CI.
- **PR 2:** fase 5 y polish. El cambio de la información de usuario y los cuatro proveedores restantes, con `/security-review`.

Dos PRs más pequeños facilitan la revisión. El cambio del módulo queda aislado en el segundo.

---

## Notes

- Cada prueba cita en su nombre el requisito que cubre (principio IV).
- Commits por task o grupo lógico, con los trailers `Spec: 004-oidc-provider-compatibility`, `Requirement:`, `Task:` y `Jira:`. La clave de Jira sale de `/sdd-sync`.
- El escenario `user-management-group` pasa de `pending` a real cuando se implemente la spec 002. Esa spec añadirá la tarea correspondiente.
- Si un proveedor cambia de versión y se rompe algo, se registra en `limitations.md` con la versión afectada antes de tocar el módulo.
