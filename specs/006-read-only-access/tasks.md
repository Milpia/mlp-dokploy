---
description: "Task list for 006-read-only-access"
---

# Tasks: Solo lectura por entorno para qa y para ver producción

**Input**: Design documents from `/specs/006-read-only-access/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Son **obligatorias** por el principio IV de la constitución. Es una funcionalidad de
autorización: las pruebas de denegación se escriben antes que la implementación y deben fallar
primero. Cada prueba cita su `FR-###` en el nombre o en un comentario.

**Organization**: Las tareas se agrupan por user story. US1 y US2 son P1, US3 es P2, y US4 y US5 son P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: US1–US5 según spec.md.
- Rutas relativas a la raíz del repositorio:
  - pruebas: `apps/dokploy/__test__/oidc-sso/`;
  - dominio: `packages/server/src/oidc-sso/`.
- Pruebas de un archivo: `pnpm --filter=dokploy exec vitest run --config __test__/vitest.config.ts <ruta>`.
- Las pruebas con base de datos siguen el patrón PGlite de `db-adapters.test.ts` (aplican todas las migraciones del journal con `client.exec()`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tipos compartidos y esquema.

- [X] T001 Add domain types to `packages/server/src/oidc-sso/types.ts` (FR-001, FR-011, data-model.md):
  - `GroupProfile.readOnly?: true | string[]` (`false` in the JSON is parsed as absent);
  - `ReadOnlyScope = { environmentIds: string[]; serviceIds: string[]; projectIds: string[] }`;
  - event reasons `"read_only"`, `"read_only_check_failed"`, `"container_mismatch"` and `"out_of_scope"`;
  - constants `MAX_READ_ONLY_ENVIRONMENTS = 20`, `READ_ONLY_DENIED_MESSAGE = "This environment is read-only for you."`, `REDACTED_VALUE = "••••••••"` and `TERMINAL_INSPECT_TIMEOUT_MS = 5_000`
- [X] T002 Extend `packages/server/src/db/schema/oidc-sso.ts` and generate an additive migration after `0198_spicy_blackheart.sql` with `pnpm --filter=dokploy run migration:generate` (data-model.md):
  - `oidc_sso_member_profile.read_only_environment_ids`, `read_only_service_ids` and `read_only_project_ids`: `text[] not null default '{}'`
  - `oidc_sso_auth_event.resource_id`: `text`, nullable, no foreign key
  - after generating, check that `db-adapters.test.ts` applies every migration on an empty PGlite (AGENTS.md checklist)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Validación de `readOnly`, unión de grupos, guardado, caché y eventos. Todas las
historias dependen de esta fase.

- [X] T003 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/group-profiles.test.ts` for `readOnly` in `parseGroupProfiles` (FR-001, FR-014, research R1, contracts/env.md), one case per rule:
  - valid: absent, `false`, `true`, `["production"]`;
  - rejected, with the exact messages of contracts/env.md:
    - a value that is not `true`, `false` or a list (`"yes"`, `{}`, `[]`);
    - an empty name, a name over 256 characters, more than 20 names;
    - a duplicate name;
    - a name in `environments.exclude`;
    - a name missing from `environments.include`;
  - the whole set is rejected when one group fails
- [X] T004 Extend `packages/server/src/oidc-sso/domain/group-profiles.ts` until T003 passes: add `readOnly` to the allowed keys of `parseProfile` and validate it against the group's `environments` filter. `mergeProfiles` keeps `readOnly` per scope part
- [X] T005 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/member-profile-scope.test.ts` (PGlite) for the read-only part of `resolveScope` (FR-001, FR-007, research R2):
  - `readOnly: true` marks every environment of the group, its services and its projects;
  - `readOnly: ["production"]` marks only `production`, and its project;
  - two groups: full access in one wins over read-only in the other for the same environment (the `devqa1` case of quickstart 13);
  - read-only environments and their services stay in `environmentIds` and `serviceIds` (upstream must still show them);
  - no `readOnly` anywhere: `readOnly` is three empty lists
- [X] T006 Extend `packages/server/src/oidc-sso/member-profile/scope.ts` until T005 passes: `ResolvedScope.readOnly` = ⋃ read-only per group − ⋃ full per group, services of those environments, projects that contain them. `ScopeCatalog` does not change
- [X] T007 Extend `packages/server/src/oidc-sso/member-profile/store.ts` and `cache.ts`, with PGlite tests in `db-adapters.test.ts` (FR-008, research R3):
  - `grant` writes the three `read_only_*` columns in the same transaction and updates `readOnlyScopeCache`;
  - `expire` empties the three columns; `revoke` deletes the row;
  - `readOnlyScopeCache` is a `Map<userId, { environmentIds: Set; serviceIds: Set; projectIds: Set }>`, fully reloaded with `memberProfileCache` every 5 minutes;
  - `getReadOnlyScope(userId)` loads the row once when the user is in `memberProfileCache` but not in the map, and throws on a read error (the callers deny, NFR-SEC-001);
  - `reset()` for tests
- [X] T008 Pass the resolved `readOnly` from `apply.ts` to `store.grant`, with a case in `member-profile-apply.test.ts`: a login that removes `readOnly` from the config leaves the three lists empty (FR-008)
- [X] T009 [P] Add `resourceId` to `AuthEventInput` and to the insert in `packages/server/src/oidc-sso/events/auth-events.ts`, and `resource=<id>` to `formatAuthEventLine`. Tests in `auth-events.test.ts`: the line never contains an email (FR-011, research R9)
- [X] T010 [P] Extend `checkGroupProfiles` in `scope.ts` and the `groupProfilesCheck` query in `apps/dokploy/server/api/routers/oidc-sso.ts` with `missingReadOnlyEnvironments` per group, and show them under the profiles field in `apps/dokploy/components/dashboard/settings/oidc-sso/oidc-sso-settings.tsx`. Tests in `member-profile-scope.test.ts` and `router.test.ts` (research R8, quickstart 15)

**Checkpoint**: el alcance de solo lectura se valida, se calcula en el login, se guarda y se lee de la
caché. Todavía nadie lo aplica.

---

## Phase 3: User Story 1 - qa revisa sin poder cambiar nada (Priority: P1) 🎯 MVP

**Goal**: un usuario de `qa` ve sus servicios y cada cambio se rechaza en el servidor, también la
terminal de contenedor.

**Independent Test**: quickstart §2, escenarios 1 a 6.

- [X] T011 [P] [US1] Write failing tests in `apps/dokploy/__test__/oidc-sso/read-only-policy.test.ts` for the pure `evaluate(rule, rawInput, scope)` (FR-003, FR-003a, FR-004a, FR-005, research R5). One truth table per rule kind of data-model.md:
  - `service`: id in `serviceIds` → deny; other id → allow; key missing → deny;
  - `environment`, `project`: same;
  - `move`: deny if the source or the target is read-only;
  - `lookup`: returns a lookup request (resource, id) instead of a verdict; a missing id → deny;
  - `unbound`: deny whenever the scope is not empty;
  - `outside`: allow;
  - `secretQuery`: deny if the target is read-only;
  - `resolveRule(path)`: exact path first, then `<router>.*`, else `undefined` (the guard denies)
- [X] T012 [US1] Implement `packages/server/src/oidc-sso/read-only/policy.ts` with `READ_ONLY_POLICY` exactly as the table of contracts/guard-and-redaction.md, plus `evaluate` and `resolveRule`, until T011 passes. Read the `forwardAuth` router before classifying it, and give it a rule in this task: every mutation needs one, or T017 fails
- [X] T013 [P] [US1] Write failing PGlite tests in `apps/dokploy/__test__/oidc-sso/read-only-lookup.test.ts` for the `SubResourceOwner` port (FR-003, FR-005, research R5). For each of `domain`, `mount`, `port`, `redirect`, `security`, `backup`, `volumeBackup`, `schedule`, `deployment`, `rollback`, `previewDeployment` and `patch`, a row that belongs to a service resolves to that service id. A row owned by nothing (for example, a mount with every service id `null`) or not found resolves to `null`, and the guard denies
- [X] T014 [US1] Implement `packages/server/src/oidc-sso/read-only/lookup.ts` (port and Drizzle adapter, one query by primary key per lookup) until T013 passes. For `volumeBackups.restoreVolumeBackupWithLogs`, resolve `id` + `serviceType` to the service
- [X] T015 [P] [US1] Write failing tests in `apps/dokploy/__test__/oidc-sso/read-only-guard.test.ts` for `createReadOnlyGuard(deps)` with fakes (FR-003, FR-005, FR-009, FR-011, NFR-SEC-001, contracts/guard-and-redaction.md). The five exits in order:
  1. not a member → `next()`, with no cache read;
  2. not in `memberProfileCache` → `next()`;
  3. empty read-only scope → `next()`;
  4. with a scope:
     - a denied mutation → `FORBIDDEN` with `READ_ONLY_DENIED_MESSAGE`, and a `member_profile`/`denied`/`read_only` event with `action` = path and `resourceId`;
     - an allowed mutation → `next()`;
     - a mutation without a rule → denied;
     - a subscription → evaluated like a mutation;
  5. any thrown error (cache, lookup) → `FORBIDDEN` and a `read_only_check_failed` event; never `next()`
- [X] T016 [US1] Implement `apps/dokploy/server/api/middlewares/read-only.ts` (`createReadOnlyGuard`, exported `readOnlyGuard`) using `path`, `type` and `getRawInput()`, like `middlewares/user-management.ts`, until T015 passes. Chain it in `apps/dokploy/server/api/trpc.ts` right after `memberProfileGuard` in `protectedProcedure` (upstream touch point listed in plan.md)
- [X] T017 [US1] Write the drift tests in `apps/dokploy/__test__/oidc-sso/read-only-drift.test.ts` (FR-005, research R5):
  - `readOnlyGuard` is in the middleware chain of `oidcSso.memberProfileStatus`, `application.deploy` and `project.create`, after `memberProfileGuard`;
  - every `mutation` and `subscription` in `appRouter._def.procedures` has a rule in `READ_ONLY_POLICY`; the failure message lists the unclassified paths;
  - add rules for any procedure the test reports, one by one, checking its input in the router
- [X] T018 [P] [US1] Write failing tests in `apps/dokploy/__test__/oidc-sso/read-only-redact.test.ts` for the pure `redact(data, scope)` (FR-006, FR-006a, research R6):
  - `.env` fields become `NAME=••••••••`, comment lines are dropped, blank lines are kept;
  - `databasePassword`, `databaseRootPassword`, `password`, `refreshToken`, the `content` of file mounts, `composeFile` and `command` become `REDACTED_VALUE`; `dockerfile` (a path), `buildType`, the branch and the repository stay visible; `null` stays `null`;
  - the ownership rules: by `environmentId`, by service id, a project row by `projectId` with `env` and no `environmentId`, and inheritance only for children without identifying keys;
  - a `backup.one`-shaped object hides the embedded database password and keeps date, status and size;
  - the input is not mutated
- [X] T019 [US1] Implement `packages/server/src/oidc-sso/read-only/redact.ts` and `secret-fields.ts` (`SECRET_FIELDS`, `ENV_FIELDS` and `NOT_SECRET_FIELDS`) until T018 passes. In `readOnlyGuard`, queries with a `secretQuery` rule on a read-only target are denied; other queries return `{ ...result, data: redact(result.data, scope) }` when `result.ok`. Add the query cases to `read-only-guard.test.ts`, including FR-002 and US1-1: with the `qa` scope, `application.one`, `application.readLogs`, `deployment.allByType`, `application.readAppMonitoring` and `backup.one` are never denied, and they return state, logs, monitoring and deployment history with only the secret fields masked
- [X] T020 [US1] Write the column drift test in `read-only-drift.test.ts` (FR-006, research R6): every column of the service tables, `project`, `environment`, `mount`, `security` and `backup` whose name matches `/password|secret|token|env|key|content/i` is in `SECRET_FIELDS`, `ENV_FIELDS` or `NOT_SECRET_FIELDS`
- [X] T021 [P] [US1] Write failing tests in `apps/dokploy/__test__/oidc-sso/read-only-wss.test.ts` for `checkContainerBinding` with a fake `ContainerInspector` (FR-004, FR-004b, FR-005, research R7):
  - not a profiled member → allowed with no inspection;
  - missing `serviceId` → denied;
  - labels match the service `appName` (`com.docker.swarm.service.name`, `com.docker.compose.project`, `com.docker.stack.namespace`) → allowed;
  - another service's container → denied with reason `container_mismatch`;
  - inspection error or timeout (5 s) → denied;
  - terminal on a service in `readOnlyServiceIds` → denied with reason `read_only`; logs of the same container → allowed
- [X] T022 [US1] Implement `packages/server/src/oidc-sso/read-only/wss.ts` (`checkContainerBinding`, the `ContainerInspector` port and its dockerode/SSH adapter with `TERMINAL_INSPECT_TIMEOUT_MS`) until T021 passes. Call it after `canAccessDockerOverWss` in `apps/dokploy/server/wss/docker-container-terminal.ts` (mode `terminal`) and `docker-container-logs.ts` (mode `logs`), closing with `4003` and recording the event. Mock the module in `apps/dokploy/__test__/wss/*.test.ts`
- [X] T023 [US1] Add e2e scenarios in `apps/dokploy/__test__/oidc-sso/e2e/keycloak.e2e.test.ts` (quickstart 1–3, SC-001):
  - seed: `qa1` in group `qa`, and the profiles of quickstart;
  - a real Keycloak `qa` login resolves `milpia/staging` as read-only, with `production` excluded;
  - the resolved guard denies `application.deploy` and allows the query of the same service with redacted `env`

**Checkpoint**: US1 funciona por sí sola. Es el MVP: se puede dar acceso a `qa`.

---

## Phase 4: User Story 2 - developers ven producción sin poder cambiarla (Priority: P1)

**Goal**: un developer opera staging como en la 005 y ve producción sin poder cambiarla, tampoco a
través de las variables del proyecto.

**Independent Test**: quickstart §2, escenarios 7 a 13.

- [X] T024 [P] [US2] Add tests to `read-only-guard.test.ts` with the developer scope (`production` read-only, `staging` full) (US2-1–US2-4, FR-003a, FR-007, SC-003):
  - `application.deploy` and `application.saveEnvironment` on staging → allowed; on production → denied;
  - `project.update`, `project.remove` and `project.duplicate` on `milpia` → denied;
  - `environment.duplicate` of production → denied; `environment.create` → allowed
- [X] T025 [P] [US2] Add tests to `read-only-redact.test.ts` with a `project.one`-shaped response that holds both environments (US2-1, FR-006, FR-007): staging values visible, production values and project `env` masked
- [X] T026 [US2] Add e2e scenarios in `keycloak.e2e.test.ts` (quickstart 7–13):
  - `dev1` with `readOnly: ["production"]`: `production` is read-only and `staging` is full;
  - `devqa1` in `developers` and `qa`: `staging` is full, since full access wins (FR-007)

**Checkpoint**: US1 y US2 funcionan. Se puede cambiar la configuración de `developers` en el lab.

---

## Phase 5: User Story 3 - La restricción se cumple por todas las vías y caduca igual (Priority: P2)

**Goal**: la solo lectura se cumple con claves de API y en todos los WebSocket, y caduca con el perfil.
Esta fase cierra MIL-545 y MIL-546.

**Independent Test**: quickstart §2, escenarios 3, 4, 11, 12b, 12c y 14.

- [X] T027 [P] [US3] Write a failing test in `read-only-guard.test.ts`: a call through `createOpenApiNextHandler` with an API-key context of a read-only member (`/api/application.deploy`) is denied, and a query returns redacted data (US3-1, FR-005, SC-002)
- [X] T028 [P] [US3] Write failing tests in `read-only-wss.test.ts` for `checkDeploymentLogAccess` with fakes (FR-004c, FR-008, US3-5, MIL-546):
  - not a profiled member → allowed with no query;
  - expired profile → denied with reason `profile_expired`;
  - `logPath` of a deployment of a service in `accessedServices` → allowed, also when read-only;
  - a service outside the scope, an unknown `logPath` or a deployment not tied to a service → denied with reason `out_of_scope`
- [X] T029 [US3] Implement `checkDeploymentLogAccess` in `packages/server/src/oidc-sso/read-only/wss.ts` (resolve `deployment.logPath` to `applicationId`/`composeId` directly, or through the preview deployment, backup, volume backup or schedule) until T028 passes. Call it before the `tail` in `apps/dokploy/server/wss/listen-deployment.ts`
- [X] T030 [US3] Write failing tests, then deny `/terminal` for a user with any read-only environment and add the 005 expiry check to `canAccessTerminalOverWss` in `canAccessTerminalOverWss` in `apps/dokploy/server/wss/authorize.ts`, where the container expiry check already lives (FR-004a, FR-008, US3-6). Tests in `read-only-wss.test.ts` and the mock in `apps/dokploy/__test__/wss/authorize.test.ts`
- [X] T031 [US3] Add a test to `member-profile-expiry.test.ts`: after `expire`, `getReadOnlyScope` returns empty lists and the member has no scope left, so `readOnlyGuard` exits at step 3 and upstream denies (US3-3, FR-008)
- [X] T032 [US3] Write the regression tests named after the bugs, which must fail on `canary` `449acf0c4` and pass now: `MIL-545: container of another service is refused` and `MIL-546: deployment log outside the scope is refused` in `read-only-wss.test.ts`. Record them in `regression_test` of MIL-545 and MIL-546 in `specs/005-developer-access/traceability.yaml`

**Checkpoint**: todas las vías del spec cubiertas; MIL-545 y MIL-546 arreglados para members con perfil.

---

## Phase 6: User Story 4 - La interfaz no ofrece lo que no se puede hacer (Priority: P3)

**Goal**: indicador de solo lectura y acciones de cambio desactivadas.

**Independent Test**: quickstart §2, escenarios 1 y 2 (insignia y botón de guardar desactivado).

- [X] T033 [P] [US4] Extend `oidcSso.memberProfileStatus` in `apps/dokploy/server/api/routers/oidc-sso.ts` and `packages/server/src/oidc-sso/member-profile/status.ts` with `readOnly: { environmentIds, serviceIds, projectIds }` from `readOnlyScopeCache`, with no new queries (contracts/guard-and-redaction.md). Tests in `router.test.ts`
- [X] T034 [US4] Create `apps/dokploy/components/dashboard/settings/oidc-sso/read-only-boundary.tsx`: given a `serviceId`, if it is read-only for the user, it shows a «Solo lectura» badge and renders its children inside `<fieldset disabled>`; otherwise it renders the children unchanged (FR-010, research R10). Tests in `member-profile-view.test.ts`
- [X] T035 [US4] Mount `ReadOnlyBoundary` in the 8 service pages under `apps/dokploy/pages/dashboard/project/[projectId]/environment/[environmentId]/services/{application,compose,postgres,mysql,mariadb,mongo,redis,libsql}/`, around the tabs that change things (general actions, environment, domains, advanced and volumes, backups, schedules), and never around logs, monitoring or deployments. Only wrappers, no logic changes (principle II)

**Checkpoint**: la interfaz refleja la solo lectura.

---

## Phase 7: User Story 5 - Sin configuración, nada cambia (Priority: P3)

**Goal**: sin `readOnly`, el comportamiento es el de la 005.

**Independent Test**: quickstart §2, escenarios 17 y 18; la suite de la 005 sin cambios.

- [X] T036 [P] [US5] Add tests in `read-only-guard.test.ts` and `read-only-wss.test.ts` (US5-1, FR-009, FR-012, SC-004):
  - with profiles and no `readOnly`, `readOnlyGuard` makes zero cache loads and zero queries, and a developer deploys;
  - the owner, an admin and a member without a profile never reach the cache in the guard or in the WebSocket checks
- [X] T037 [US5] Run the whole `__test__/oidc-sso` suite and `__test__/wss` and check that the 005 tests pass without changes other than the documented mocks (SC-004)

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T038 [P] Add the block `performance · read-only (spec 006)` in `apps/dokploy/__test__/oidc-sso/performance.test.ts` (NFR-PERF-001, research R12):
  - zero DB reads for owner, admin, a member without a profile and a member without read-only;
  - a direct-rule mutation ≤ 1 ms p95;
  - a `lookup` mutation ≤ 5 ms p95 (PGlite);
  - `redact` over a `project.all`-shaped response with 200 projects and 500 services ≤ 5 ms p95;
  - `checkDeploymentLogAccess` ≤ 5 ms p95 (PGlite)
  - attach the bench output to the PR (constitution VI)
- [X] T039 [P] Document the feature in `specs/001-keycloak-sso/operations.md`: a «Solo lectura por entorno» section with `readOnly`, the Milpia example, what is hidden, the WebSocket rules, the `read_only`, `container_mismatch` and `out_of_scope` events, and the rotation advice of research R6-a
- [X] T040 Run `/security-review` on the branch and fix its findings (constitution III, research R11). Also check FR-013 explicitly:
  - no import from any `/proprietary` path and no use of custom roles in the new code;
  - no literal `qa`, `developers` or `production` outside tests, docs and examples
- [X] T041 Run `pnpm typecheck`, `npx biome check` on the touched files, the server declaration build (`pnpm --filter=@dokploy/server run build`, then `git checkout packages/server/package.json`) and the full `oidc-sso` suite. Then run the suite with `--coverage` and check the constitution IV thresholds, attaching the report to the PR:
  - ≥ 80 % of lines in the new module code;
  - ≥ 90 % in `packages/server/src/oidc-sso/read-only/**` and `apps/dokploy/server/api/middlewares/read-only.ts`;
  - 100 % of the branches of `evaluate`, `redact`, `checkContainerBinding` and `checkDeploymentLogAccess`
  - result (2026-09-28): typecheck, biome on the Milpia files and the server declaration build pass. Coverage of the new code, 845 tests of `oidc-sso` and `wss` with the Keycloak e2e: 98.7 % lines and 96.8 % branches overall; `read-only/**` and `middlewares/read-only.ts` at 100 % lines; `policy.ts` (evaluate), `redact.ts` and `guard.ts` at 100 % branches; `wss.ts` at 100 % lines, with every branch of `checkContainerBinding`, `checkDeploymentLogAccess` and `checkServerTerminal` covered. The uncovered lines of `member-profile/status.ts` are spec 005 code. Timing budgets measured without coverage (instrumentation inflates them): a direct rule 0.003 ms p95 and masking a 200-project `project.all` 0.71 ms p95
- [X] T042 Run the quickstart manual scenarios in the lab with the canary image and record the results in the lab PR (SC-001–SC-004). Then tell infra to add `qa` to `SSO_OIDC_ACCESS_GROUP` and `deploy_access_groups`
  - result (2026-10-02, MIL-570): the first run on b33ef1f failed and found MIL-573 (mlp-deploy-lab PR #27), fixed by T044. On 85eaf61 scenarios 1–10, 12, 12c, 12d and 13–18 pass, plus a run with the production configuration (developers with production excluded, qa read-only), without restarting Dokploy between scenarios (mlp-deploy-lab PR #28); 11 and 12b pass with the private steps (mlp-deploy-lab PR #29, results only). Not checked in the lab: the read-only badge and the disabled buttons on screen (US4, FR-010). Telling infra to add `qa` belongs to its spec 016
- [ ] T043 Report the WebSocket finding of MIL-545 to upstream Dokploy through its private security channel (details in the private repository), and link it from MIL-545
- [X] T044 Fix the refresh of the read-only scope after an SSO login, found by the T042 lab run (MIL-573, FR-008, research R3). The login runs in the auth instance that upstream shares across bundles through `globalThis`, so its invalidation reached another copy of the cache than the one the tRPC guard and the WebSocket checks read. The caches now live on `globalThis`, the login and the expiry invalidate again after their commit, and a read that overlaps an invalidation is not kept. Regression tests in `read-only-refresh.test.ts` (login → expiry → login, and a profile change between two logins, without a restart) and `read-only-scope.test.ts`

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → historias.** Dentro de la fase 2: T003 → T004; T005 → T006; T006 → T007 → T008. T009 y T010 en paralelo.
- **US1 (T011–T023)** depende de la fase 2. Dentro: T011 → T012; T013 → T014; T012 y T014 → T015 → T016 → T017; T018 → T019 → T020; T021 → T022. Es el MVP.
- **US2 (T024–T026)** depende de US1 (usa el guard y `redact`).
- **US3 (T027–T032)** depende de US1: T028 → T029; T032 después de T022 y T029.
- **US4 (T033–T035)** depende de la fase 2. Puede ir en paralelo con US2 y US3.
- **US5 (T036–T037)** depende de US1 y US3.
- **Fase 8** al final. T042 necesita la imagen de canary.

## Parallel Example

```text
# Fase 2, después de T001–T002:
T003 readOnly parser tests  |  T005 scope tests (PGlite)  |  T009 event resourceId  |  T010 groupProfilesCheck
# US1, después de la fase 2:
T011 policy tests  |  T013 lookup tests (PGlite)  |  T018 redact tests  |  T021 wss binding tests
# Con US1 terminado:
T024–T025 (US2)  |  T027–T028 (US3)  |  T033 (US4)
```

## Implementation Strategy

1. **MVP:** fase 1, fase 2 y US1. `qa` puede entrar sin cambiar nada.
2. **Garantías P1:** US2, con los developers viendo producción.
3. **Todas las vías:** US3, que además cierra MIL-545 y MIL-546.
4. **Cierre:** US4, US5, la fase 8 y el lab. Solo después, el PR de infra que abre el acceso a `qa`.
