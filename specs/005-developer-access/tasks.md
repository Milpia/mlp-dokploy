---
description: "Task list for 005-developer-access"
---

# Tasks: Los developers entran por SSO con su perfil y solo a sus proyectos

**Input**: Design documents from `/specs/005-developer-access/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Son **obligatorias** por el principio IV de la constitución. Es una funcionalidad de
autorización: las pruebas de denegación y de revocación se escriben antes que la implementación y
deben fallar primero.

**Organization**: Las tareas se agrupan por user story. US1 y US2 son P1, US3 y US4 son P2, y US5 es P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: US1–US5 según spec.md.
- Rutas relativas a la raíz del repositorio:
  - pruebas: `apps/dokploy/__test__/oidc-sso/`;
  - dominio: `packages/server/src/oidc-sso/`.
- Pruebas de un archivo: `pnpm --filter=dokploy exec vitest run --config __test__/vitest.config.ts <ruta>`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tipos compartidos y esquema.

- [X] T001 Add domain types to `packages/server/src/oidc-sso/types.ts` (FR-001, FR-008, FR-017, R9):
  - `MEMBER_PERMISSIONS` as a readonly tuple of the 11 upstream column names (`canCreateProjects`, `canDeleteProjects`, `canCreateServices`, `canDeleteServices`, `canCreateEnvironments`, `canDeleteEnvironments`, `canAccessToDocker`, `canAccessToAPI`, `canAccessToSSHKeys`, `canAccessToGitProviders`, `canAccessToTraefikFiles`), and `MemberPermission` derived from it
  - `GroupProfile = { group: string; permissions: MemberPermission[]; projects: string[]; environments?: { include: string[] } | { exclude: string[] } }`
  - add `"member_profile"` to `AuthEventType`; reasons `"profile_expired"` and `"profile_failed"`
  - add `"groupProfiles"` to `ConfigField`
- [X] T002 Extend `packages/server/src/db/schema/oidc-sso.ts` and generate an additive migration after `0197_equal_wallflower.sql` with `pnpm --filter=dokploy run migration:generate` (data-model.md):
  - `oidc_sso_config.group_profiles`: `text`, nullable, default `null`
  - new table `oidc_sso_member_profile`:
    - `user_id text` PK, FK → `user.id` `on delete cascade`
    - `organization_id text not null`, FK → `organization.id` `on delete cascade`
    - `groups text[] not null`
    - `applied_at timestamp not null`
    - `expired_at timestamp` nullable
    - `updated_at timestamp not null`
  - after generating, check that `db-adapters.test.ts` applies all 199 migrations on an empty PGlite (AGENTS.md checklist)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Validación de la configuración, configuración por entorno y pantalla, resolución del
alcance y la decisión de R3. Todas las historias dependen de esta fase.

- [X] T003 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/group-profiles.test.ts` for `parseGroupProfiles(json)` and `mergeProfiles(profiles, userGroups)` (FR-006, FR-008, FR-009, R10), one case per rule:
  - valid config;
  - rejected:
    - invalid JSON;
    - more than 16 384 bytes;
    - unknown permission (e.g. `"canDeploy"`);
    - empty group name or one over 256 characters;
    - more than 20 groups;
    - more than 200 projects in a group;
    - more than 20 environments in a list;
    - `include` and `exclude` together;
    - missing `permissions` or `projects`;
  - merge: union of permissions (OR) and of projects, with environments kept per group; groups compared after the same normalization as `normalizeLoginGroups`
- [X] T004 Implement `packages/server/src/oidc-sso/domain/group-profiles.ts` (pure, zod) until T003 passes. Errors carry a path such as `developers.permissions[0]: unknown permission "canDeploy"`. On any error the whole set is rejected (FR-009)
- [X] T005 [P] Rename `USER_MANAGEMENT_GRANT_TTL_MS` to `SSO_GRANT_TTL_MS` in `packages/server/src/oidc-sso/domain/user-management.ts` and update its imports. Spec 002 tests must pass unchanged in behaviour
- [X] T006 Write failing tests, then add `groupProfiles` to the configuration (FR-001, FR-009, FR-012, R4):
  - tests in `config-env.test.ts`, `config-provider.test.ts` and `config-admin.test.ts`:
    - `SSO_OIDC_GROUP_PROFILES` wins over the stored value and is reported with source `env`;
    - blank means unset;
    - an invalid value is ignored and reported in env errors;
    - an update of an env-set field throws `env_locked`;
    - a saved change produces a `config_change` event that lists `groupProfiles`;
  - implementation in `config/env.ts`, `config/repository.ts`, `config/provider.ts` and `admin/config-admin.ts`, validating with `parseGroupProfiles`
- [X] T007 Extend `apps/dokploy/server/api/routers/oidc-sso.ts` (contracts/trpc-and-guard.md):
  - `update` accepts `groupProfiles: z.string().max(16384).nullable().optional()`; invalid content returns `BAD_REQUEST` with the validation message;
  - `get` returns `groupProfiles` with its source;
  - tests in `router.test.ts`
- [X] T008 [P] Write failing PGlite tests in `apps/dokploy/__test__/oidc-sso/member-profile-scope.test.ts` for `resolveScope(profiles, organizationId)` (FR-002, FR-016, R5):
  - projects by name, including two projects with the same name;
  - `exclude: ["production"]` and `include: ["staging"]`;
  - services from all 8 tables (`application`, `compose`, `postgres`, `mysql`, `mariadb`, `mongo`, `redis`, `libsql`);
  - unknown names ignored;
  - other organizations never included;
  - the union across several profiles
- [X] T009 Implement `packages/server/src/oidc-sso/member-profile/scope.ts` (`resolveScope`, port `ScopeCatalog`) and its Drizzle adapter until T008 passes. Add `checkGroupProfiles(profiles, organizationId)` that returns `missingProjects` and `ambiguousProjects` per group (R5)
- [X] T010 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/member-profile-apply.test.ts` for `applyGroupProfile({ userId, organizationId, finalRole, groups, profiles, now })` with fake stores. Cover the full table of research R3 plus R8:
  - member in a profiled group overwrites all 11 flags (not-granted → `false`) and the three lists, and upserts the row with `expired_at = null`;
  - member with a row and no profiled group clears flags and lists and deletes the row;
  - member without a row and no profiled group: no write;
  - admin or owner with a row: clear and delete;
  - custom role: no write;
  - no `groupProfiles` configured: no write at all
- [X] T011 Implement `packages/server/src/oidc-sso/member-profile/store.ts` (`MemberProfileStore`, Drizzle adapter over `member` and `oidc_sso_member_profile`) with PGlite tests in `db-adapters.test.ts`:
  - flags and lists written and cleared;
  - the row upserted, marked expired and deleted;
  - `accessedGitProviders`, `accessedServers` and `role` never touched
- [X] T012 Implement `packages/server/src/oidc-sso/member-profile/apply.ts` until T010 passes

**Checkpoint**: la configuración se valida y se guarda, y el alcance y la decisión de R3 se calculan.
Todavía no se aplican en el login.

---

## Phase 3: User Story 1 - Un developer entra y trabaja en sus proyectos (Priority: P1) 🎯 MVP

**Goal**: en el login por SSO, un member de un grupo con perfil recibe sus permisos y su alcance.

**Independent Test**: quickstart §2, escenarios 1 y 2.

- [X] T013 [US1] Write failing tests in `apps/dokploy/__test__/oidc-sso/provisioning.test.ts` (US1-1, NFR-SEC-001):
  - a first SSO login of a `developers` member writes flags, scope and the profile row in the same transaction as `ensureMembership` and `recordLoginState`;
  - if `applyGroupProfile` throws, nothing is committed and the login fails as `sso_unavailable`, recording a `sso_login`/`error`/`profile_failed` event with its reference
- [X] T014 [US1] Call `applyGroupProfile` inside the transaction of `provisionIdentity` in `packages/server/src/oidc-sso/identity/provisioning.ts`, after `ensureMembership` and `recordLoginState`, with the final role. Add it to `ProvisioningTx`
- [X] T015 [US1] Pass the effective `groupProfiles` from `services.config.getEffective()` in `packages/server/src/oidc-sso/plugin/login-flow.ts`, and record the `profile_failed` event on failure (R9)
- [ ] T016 [US1] Extend the e2e seed and add scenarios in `apps/dokploy/__test__/oidc-sso/e2e/keycloak.e2e.test.ts`:
  - seed: `developers` users `dev1` and `dev2` in the Keycloak realm; projects `alpha` and `beta` (environments `production` and `staging`) and `gamma` (`production`), with one application in each environment; `SSO_OIDC_GROUP_PROFILES` as in quickstart;
  - scenario: `dev1` sees exactly `alpha` and `beta` with `staging` and deploys a service there (quickstart 1–2, SC-001)

**Checkpoint**: US1 funciona por sí sola. Es el MVP.

---

## Phase 4: User Story 2 - Un developer no puede hacer lo de admins y leads (Priority: P1)

**Goal**: todo lo que queda fuera del perfil se rechaza en el servidor.

**Independent Test**: quickstart §2, escenarios 3 y 4.

- [ ] T017 [P] [US2] Write tests in `apps/dokploy/__test__/oidc-sso/member-profile-denials.test.ts` using upstream `checkPermission`, `checkProjectAccess`, `checkEnvironmentAccess` and `checkServiceAccess` against a PGlite member written by `applyGroupProfile` with `permissions: []` (FR-008, FR-010, SC-002). Each of these must be rejected:
  - create or delete a project, a service or an environment;
  - `docker.read`, `traefikFiles.read`, `sshKeys.read`, `gitProviders.read` and `api.read`;
  - a service of a project outside the scope;
  - a service of the excluded `production` environment
  - widening its own profile or scope (NFR-SEC-002): `user.assignPermissions` on itself (rejected by the spec 002 guard) and `oidcSso.update` (rejected by `ownerProcedure`)
- [ ] T018 [US2] Add e2e direct-call denials with the developer's cookie to `keycloak.e2e.test.ts`: create a project, list Docker containers and operate a service of `gamma` by id (quickstart 3–4)

**Checkpoint**: US1 y US2 cumplen SC-001 y SC-002.

---

## Phase 5: User Story 3 - El owner define perfiles y ve el origen (Priority: P2)

**Goal**: configurar desde la pantalla, detectar nombres que no coinciden y avisar en la lista de usuarios.

**Independent Test**: quickstart §2, escenarios 5, 11 y 12.

- [ ] T019 [US3] Add `oidcSso.groupProfilesCheck` (owner) to `apps/dokploy/server/api/routers/oidc-sso.ts`, returning `missingProjects`, `ambiguousProjects` and `projectsResolved` per group (contracts/trpc-and-guard.md), with tests in `router.test.ts`
- [ ] T020 [US3] Add `oidcSso.memberProfiles` (owner and admin) returning `userId → { groups, appliedAt, expired }`, with tests (FR-011)
- [ ] T021 [US3] Add the «Group profiles» JSON field to `apps/dokploy/components/dashboard/settings/oidc-sso/oidc-sso-settings.tsx`:
  - locked with the env badge when the source is `env`;
  - the validation error shown under the field;
  - the result of `groupProfilesCheck` (projects not found, ambiguous) shown below
- [ ] T022 [P] [US3] Create `apps/dokploy/components/dashboard/settings/oidc-sso/member-profile-badge.tsx` («SSO: <groups>») and mount it next to the role badge in `apps/dokploy/components/dashboard/settings/users/show-users.tsx` (upstream mount point)
- [ ] T023 [US3] Create the overwrite notice in `apps/dokploy/components/dashboard/settings/oidc-sso/member-profile-notice.tsx`: «These permissions come from SSO group(s) …; changes made here are replaced at the user's next SSO login». Mount it below the dialog header in `apps/dokploy/components/dashboard/settings/users/add-permissions.tsx` (upstream mount point). Put the visibility logic in a pure helper, with tests

**Checkpoint**: el owner configura y los admins ven de dónde vienen los permisos.

---

## Phase 6: User Story 4 - Un cambio de grupo se refleja (Priority: P2)

**Goal**: revocar al salir del grupo y caducar a las 8 horas del último login por SSO.

**Independent Test**: quickstart §2, escenarios 7, 8 y 9.

- [ ] T024 [P] [US4] Write failing tests in `apps/dokploy/__test__/oidc-sso/member-profile-expiry.test.ts` for `checkMemberProfileExpiry` covering the five exits of contracts/trpc-and-guard.md:
  - not a member: no reads;
  - not in the cache: no reads;
  - valid: pass;
  - expired: clears in a transaction, sets `expired_at` and records the `member_profile`/`denied`/`profile_expired` event, then passes;
  - error: `FORBIDDEN` with «Your access expired. Sign in with SSO again.» and a `member_profile`/`error` event;
  - the cache is loaded at startup and updated on every store write
- [ ] T025 [US4] Implement `packages/server/src/oidc-sso/member-profile/expiry.ts` (checker + in-memory user cache) until T024 passes, using `SSO_GRANT_TTL_MS`
- [ ] T026 [US4] Create the tRPC middleware `apps/dokploy/server/api/middlewares/member-profile.ts` and chain it in `protectedProcedure` after `userManagementGuard` in `apps/dokploy/server/api/trpc.ts` (upstream). Add a drift test in `apps/dokploy/__test__/oidc-sso/member-profile-drift.test.ts` asserting that the middleware is in the chain of `protectedProcedure` and of a `withPermission(...)` procedure
- [ ] T027 [US4] Add `oidcSso.memberProfileStatus` (any session) returning `{ managed, groups, expiresAt, expired }`. Show the expired notice with `SignInWithSso` on `apps/dokploy/pages/dashboard/projects.tsx` (upstream mount point) through `member-profile-notice.tsx` (FR-017)
- [ ] T028 [US4] Add e2e scenarios to `keycloak.e2e.test.ts`:
  - leaving `developers` and logging in again removes the scope;
  - `last_sso_login_at` 9 h ago hides the projects and records `profile_expired`, and logging in again restores them;
  - moving to `leads` makes the user admin without the badge

  (quickstart 7–9, SC-003)

**Checkpoint**: el acceso se revoca solo, a más tardar 8 horas después del último login.

---

## Phase 7: User Story 5 - Sin configuración, nada cambia (Priority: P3)

**Goal**: el principio II, comprobado.

**Independent Test**: quickstart §2, escenarios 10 y 13.

- [ ] T029 [US5] Add tests in `apps/dokploy/__test__/oidc-sso/member-profile-apply.test.ts` and `member-profile-expiry.test.ts`:
  - without `groupProfiles`, a member with manual permissions logs in by SSO and nothing changes;
  - the guard makes no reads;
  - a member without a profile row in a configured instance keeps manual permissions (FR-005, FR-013, SC-004)
- [ ] T030 [US5] Run the whole test suite of `apps/dokploy` and confirm that the existing permission tests pass without changes (SC-004)

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T031 [P] Add benches in `apps/dokploy/__test__/oidc-sso/performance.test.ts`:
  - `applyGroupProfile` with 200 projects and 500 services: p95 ≤ 50 ms (NFR-PERF-001);
  - `memberProfileGuard` for a member with a profile: p95 ≤ 5 ms, and zero queries for admin and for a member without a profile (NFR-PERF-002)
- [ ] T032 [P] Document the feature in `specs/001-keycloak-sso/operations.md`:
  - a «Perfiles por grupo» section with the format of `SSO_OIDC_GROUP_PROFILES`, the Milpia example, the 8-hour expiry and the `profile_expired`/`profile_failed` events;
  - how to read `groupProfilesCheck`
- [ ] T033 Run `/security-review` on the branch and fix its findings (constitution III, research R11)
- [ ] T034 Run `pnpm typecheck`, `npx biome check` on the touched files, the server declaration build (`pnpm --filter=@dokploy/server run build`, then `git checkout packages/server/package.json`) and the full `oidc-sso` suite
- [ ] T035 Run the quickstart manual scenarios 1–13 in the lab with the canary image and record the results in the lab PR (SC-001–SC-004). Then tell infra to add `developers` to `SSO_OIDC_ACCESS_GROUP` and `deploy_access_groups`

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → historias.** Dentro de la fase 2: T003 → T004; T006 → T007; T008 → T009; T010 y T011 → T012.
- **US1 (T013–T016)** depende de la fase 2. Es el MVP.
- **US2 (T017–T018)** depende de US1: necesita el perfil aplicado.
- **US3 (T019–T023)** depende de la fase 2. T020–T023 pueden ir en paralelo con US2.
- **US4 (T024–T028)** depende de US1: necesita las filas de perfil.
- **US5 (T029–T030)** depende de US1 y US4.
- **Fase 8** al final. T035 necesita la imagen de canary.

## Parallel Example

```text
# Fase 2, después de T001–T002:
T003 group-profiles tests   |  T005 rename TTL  |  T008 scope tests (PGlite)  |  T010 apply tests
# US3, con US2 en curso:
T022 badge (show-users)     |  T020 memberProfiles query
```

## Implementation Strategy

1. **MVP:** fase 1, fase 2 y US1. Un developer entra y ve sus proyectos.
2. **Garantías P1:** US2, con pruebas de denegación sobre las comprobaciones de upstream.
3. **Operación:** US3 (configurar y ver el origen) y US4 (revocación y caducidad).
4. **Cierre:** US5, fase 8 y el lab. Solo después, el PR de infra que abre el acceso a `developers`.
