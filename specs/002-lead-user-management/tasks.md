---
description: "Task list for 002-lead-user-management"
---

# Tasks: Los leads operan como admin pero no gestionan usuarios

**Input**: Design documents from `/specs/002-lead-user-management/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Son **obligatorias** por el principio IV de la constitución. Esta funcionalidad es de
autorización, así que las pruebas de denegación se escriben antes que la implementación y deben
fallar primero.

**Organization**: Las tareas se agrupan por user story. US1 y US2 son P1; US3 es P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: US1–US3 según spec.md.
- Rutas relativas a la raíz del repositorio:
  - pruebas: `apps/dokploy/__test__/oidc-sso/`;
  - dominio: `packages/server/src/oidc-sso/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tipos compartidos.

- [X] T001 Add domain types to `packages/server/src/oidc-sso/types.ts` (FR-004, FR-012):
  - `UserManagementAction = "remove_user" | "remove_member" | "invite" | "create_user" | "resend_invitation" | "cancel_invitation" | "change_role" | "change_permissions" | "manage_roles"`
  - `UserManagementDenyReason = "no_sso_login" | "grant_expired" | "not_in_group" | "check_failed"`
  - add `"user_management"` to `AuthEventType`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema, política, configuración, constancia de grupos, eventos y la guarda común.
Lo usan todas las stories.

**⚠️ CRITICAL**: ninguna user story puede empezar hasta terminar esta fase.

- [X] T002 Extend `packages/server/src/db/schema/oidc-sso.ts` and generate an additive migration in `apps/dokploy/drizzle/` after `0196_chief_goliath.sql` with `pnpm --filter=dokploy run migration:generate` (FR-001, FR-008, FR-012, data-model.md):
  - `oidc_sso_config.user_management_group` text, nullable, default `null`.
  - New table `oidc_sso_login_state`:
    - `user_id` text PK, FK → `user.id` `ON DELETE CASCADE`;
    - `groups` text[] not null;
    - `last_sso_login_at` timestamp not null;
    - `updated_at` timestamp not null.
  - `oidc_sso_auth_event.action` text, nullable.
  - `oidc_sso_auth_event.target_user_id` text, nullable, with no FK.
- [X] T003 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/user-management-policy.test.ts` covering every branch of research R4, in order (FR-003, FR-009, FR-010, FR-014, FR-015, NFR-SEC-001):
  - SSO inactive → allow.
  - Group not configured → allow.
  - Instance owner → allow, even with no login state or an expired one.
  - No login state → `no_sso_login`.
  - `lastSsoLoginAt` exactly 8 h ago → `grant_expired`. 7 h 59 min → evaluated normally.
  - Groups outside the configured group → `not_in_group`.
  - A user in `admins` and `leads` with group `admins` → allow.
  - A comma list in the configured group → allow when any entry matches.
- [X] T004 Implement the pure `decideUserManagement(input: UserManagementInput)` and `USER_MANAGEMENT_GRANT_TTL_MS = 8 * 60 * 60 * 1000` in `packages/server/src/oidc-sso/domain/user-management.ts` to pass T003. Reuse `isInGroup` from `domain/claims.ts` (FR-002, FR-003, FR-015).
- [X] T005 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/config-env.test.ts`, `config-provider.test.ts` and `db-adapters.test.ts` for `userManagementGroup` (FR-001, FR-002):
  - `SSO_OIDC_USER_MANAGEMENT_GROUP` is trimmed, and empty means undefined.
  - It is limited to "≤ 512 caracteres"; longer is reported as an env error.
  - The env value wins over the stored one, and `sources.userManagementGroup` is `"env"`.
  - The repository round-trips the value.
- [X] T006 Add `userManagementGroup` to `packages/server/src/oidc-sso/config/env.ts`, `config/repository.ts` and `config/provider.ts`, following `adminGroup` exactly, to pass T005 (FR-001, FR-002).
- [X] T007 [P] Write failing tests in `apps/dokploy/__test__/oidc-sso/login-state.test.ts` (PGlite) and `provisioning.test.ts` (FR-008, FR-014, data-model.md):
  - A successful non-owner SSO login upserts `oidc_sso_login_state` inside the provisioning transaction, with sorted groups and the login time.
  - The owner's login writes nothing.
  - A denied login writes nothing.
  - Groups are capped at "como máximo 100 elementos de 256 caracteres". Longer entries are dropped, and after sorting only the first 100 are kept.
  - Deleting the user cascades.
- [X] T008 Implement `LoginStateStore` (`find(userId)`, `upsert(tx, {userId, groups, at})`) in `packages/server/src/oidc-sso/identity/login-state.ts`. Add `recordLoginState` to `ProvisioningTx` in `packages/server/src/oidc-sso/identity/provisioning.ts`, called only when `!isOwner`. Pass T007 (FR-008).
- [X] T009 [P] Extend `AuthEventInput`, the store and `listEvents` output in `packages/server/src/oidc-sso/events/auth-events.ts` with optional `action` and `targetUserId`, with tests in `apps/dokploy/__test__/oidc-sso/auth-events.test.ts` (FR-012).
- [X] T010 Write failing tests in `apps/dokploy/__test__/oidc-sso/user-management-guard.test.ts` for `checkUserManagement({userId, action, targetUserId?, ip?})` (FR-006, FR-012, NFR-SEC-001, contracts/user-management-guard.md):
  - It denies with the contract message for each reason.
  - It records one `user_management` / `denied` event with `action` and `target_user_id`.
  - It allows without recording anything.
  - If the config, login-state or owner lookup throws → `check_failed`.
  - If writing the event throws → still denied, and the error is logged.
  - Messages never contain the configured group name.
  - The target user is resolved from `userId`, `memberId` or `memberIdOrEmail` as in the contract, and a failed lookup still denies and records `target_user_id = null`.
- [X] T011 Implement `checkUserManagement` in `packages/server/src/oidc-sso/user-management/guard.ts` to pass T010. It reads config from the cached provider. It runs the `instanceOwnerId()` and `LoginStateStore.find` queries in parallel, and only when the group is configured and SSO is active (NFR-PERF-001, NFR-PERF-002).
- [X] T012 [P] Create `packages/server/src/oidc-sso/user-management/paths.ts` with `TRPC_USER_MANAGEMENT_PATHS` and `AUTH_USER_MANAGEMENT_PATHS`, both `ReadonlyMap<string, UserManagementAction>`, exactly as the two tables in contracts/user-management-guard.md (FR-004).

**Checkpoint**: la política, la configuración, la constancia de grupos y la guarda están probadas
sin tocar upstream.

---

## Phase 3: User Story 1 - Un lead opera la plataforma sin poder tocar las cuentas de otros (Priority: P1) 🎯 MVP

**Goal**: toda acción de gestión de usuarios de un lead se rechaza en el servidor (tRPC y
better-auth). La interfaz no las muestra, y el resto de capacidades de admin siguen intactas.

**Independent Test**: con `SSO_OIDC_USER_MANAGEMENT_GROUP=admins`, `lead1` despliega un servicio y
recibe 403 en las 7 rutas tRPC y las 7 de better-auth. `dev1` queda igual y los intentos aparecen
en los eventos del SSO (quickstart §2, filas 1–5).

### Tests for User Story 1 ⚠️

- [X] T013 [P] [US1] Write failing tests in `apps/dokploy/__test__/oidc-sso/user-management-trpc.test.ts` for the tRPC middleware (FR-004, FR-005, FR-006, NFR-PERF-001):
  - Each of the 7 paths is denied for a lead with `FORBIDDEN`, and the handler never runs.
  - A non-listed path (`project.create`) calls `next()` with no config or DB read.
  - API-key contexts are treated like sessions.
- [X] T014 [P] [US1] Write the router drift test in `apps/dokploy/__test__/oidc-sso/user-management-drift.test.ts` (FR-004, research R2). It walks `appRouter._def.procedures` and fails when:
  - a path in `TRPC_USER_MANAGEMENT_PATHS` no longer exists;
  - a procedure whose name matches `/(member|invit|role|permission|user)/i` is neither listed nor in an explicit `REVIEWED_NOT_USER_MANAGEMENT` set in the test.
- [X] T015 [P] [US1] Write failing tests in `apps/dokploy/__test__/oidc-sso/user-management-hook.test.ts` for the better-auth `before` hook (FR-004, FR-006):
  - Each of the 7 `/organization/*` routes is denied with `APIError("FORBIDDEN")` for a lead.
  - Requests without a session are left to better-auth.
  - Other paths are ignored by the matcher.
- [X] T031 [P] [US1] Write failing tests in `apps/dokploy/__test__/oidc-sso/user-management-visibility.test.ts` for the pure helper `userManagementVisibility(upstream, status)` (FR-007, US1 scenario 3, principle IV). It takes upstream's `{ canChangeRole, canEditPermissions, canRemove, canDelete, canInvite }` and the `userManagementStatus` output, and returns the same flags plus `showExpiredNotice`. Truth table:
  - `canManageUsers: true` → upstream flags unchanged, no notice.
  - `canManageUsers: false` with `not_in_group`, `no_sso_login` or `check_failed` → every flag `false`, no notice.
  - `canManageUsers: false` with `grant_expired` → every flag `false`, `showExpiredNotice: true`.
  - Status still loading (`undefined`) → every flag `false` (fail closed while unknown).

### Implementation for User Story 1

- [X] T016 [US1] Implement `userManagementGuard` (a tRPC middleware that looks up `path` in `TRPC_USER_MANAGEMENT_PATHS`, calls `checkUserManagement`, and derives `targetUserId` from `input.userId` or from `input.memberId`, only on denial) in `apps/dokploy/server/api/middlewares/user-management.ts`. Chain it in `protectedProcedure` in `apps/dokploy/server/api/trpc.ts` (one import and one `.use`, the upstream touch point in plan.md). Pass T013 (FR-004, FR-006).
- [X] T017 [US1] Implement `createUserManagementHook` in `packages/server/src/oidc-sso/plugin/user-management-hook.ts` using `getSessionFromCtx`, passing `memberIdOrEmail` from the body as the target to resolve, and add it to the `hooks.before` array in `packages/server/src/oidc-sso/plugin/index.ts` next to the SSO-only guard. Pass T015 (FR-004, FR-006).
- [X] T018 [US1] Add the protected query `userManagementStatus` → `{ canManageUsers, reason, expiresAt }` to `apps/dokploy/server/api/routers/oidc-sso.ts`, following contracts/user-management-guard.md and without recording events. Add tests in `apps/dokploy/__test__/oidc-sso/router.test.ts` (FR-007, FR-015).
- [X] T019 [US1] Implement `userManagementVisibility` in `apps/dokploy/components/dashboard/settings/oidc-sso/user-management-visibility.ts` to pass T031, then use it at the upstream touch points in plan.md (FR-007):
  - In `apps/dokploy/components/dashboard/settings/users/show-users.tsx`, pass its upstream flags through the helper.
  - In `apps/dokploy/pages/dashboard/settings/users.tsx`, render `ShowInvitations` only when `canInvite` is true, and show a notice with a "Sign in with SSO" action when `showExpiredNotice` is true.
- [X] T020 [US1] Extend the e2e in `apps/dokploy/__test__/oidc-sso/e2e/keycloak.e2e.test.ts` and the realm in `apps/dokploy/__test__/oidc-sso/e2e/realm-dokploy-test.json` (US1 scenarios 1–4):
  - Add groups `admins`, `leads` and `developers`.
  - Add users `lead1`, `admin1`, `admin2` and `dev1` as in quickstart.md.
  - `lead1` passes a non-management call.
  - `lead1` gets 403 on `user.remove` and on `/api/auth/organization/update-member-role`.
  - Both denials appear in `listEvents`.

**Checkpoint**: US1 es entregable por sí sola.

---

## Phase 4: User Story 2 - Los admins y el owner siguen gestionando usuarios como hoy (Priority: P1)

**Goal**: quien está en el grupo de gestión, y siempre el owner, conserva todas las acciones con
las reglas actuales de upstream.

**Independent Test**: `admin1` borra a un member, `admin2` cambia permisos y el owner cambia el
rol de un admin (quickstart §2, filas 6–8).

### Tests for User Story 2 ⚠️

- [X] T021 [P] [US2] Add allow-path tests to `apps/dokploy/__test__/oidc-sso/user-management-trpc.test.ts` and `user-management-hook.test.ts` (FR-003, FR-010, FR-011, FR-015):
  - An admin in the group with a login < 8 h ago reaches the handler.
  - The owner reaches it with no login state.
  - An admin in the group still gets upstream's own `FORBIDDEN` when changing another admin's role through tRPC (the guard does not widen anything).
  - After 8 h, the same admin gets `grant_expired`.

### Implementation for User Story 2

- [X] T022 [US2] Extend the e2e in `apps/dokploy/__test__/oidc-sso/e2e/keycloak.e2e.test.ts` (US2 scenarios 1–3, FR-010):
  - `admin1` removes `dev1`.
  - `admin2` (in `admins` and `leads`) assigns permissions.
  - The owner, through the emergency local login, changes a member's role.

**Checkpoint**: US1 y US2 juntas cumplen la petición de infra.

---

## Phase 5: User Story 3 - El owner activa la restricción sin romper instancias existentes (Priority: P2)

**Goal**: el grupo se configura por interfaz o por entorno. Sin configurarlo, nada cambia.

**Independent Test**: sin la variable, `lead1` borra a un member. Con la variable definida, el
campo aparece bloqueado en la pantalla de SSO (quickstart §2, filas 9–10).

### Tests for User Story 3 ⚠️

- [X] T023 [P] [US3] Add tests to `apps/dokploy/__test__/oidc-sso/router.test.ts` (FR-001, FR-009, US3 scenarios 1–3):
  - `oidcSso.get` returns `userManagementGroup` and its source.
  - `oidcSso.update` saves it, invalidates the cache and records `config_change`.
  - `oidcSso.update` rejects it with `BAD_REQUEST` when it comes from env.
  - With the group unset, the guard allows every path without DB reads.
  - Changing the group re-evaluates existing login-state rows without rewriting them.

### Implementation for User Story 3

- [X] T024 [US3] Accept and return `userManagementGroup` in `oidcSso.get` and `oidcSso.update` in `apps/dokploy/server/api/routers/oidc-sso.ts`, with a zod `string().max(512).nullable()` after trim. Pass T023 (FR-001, FR-002).
- [X] T025 [US3] Add the "User management group" field in `apps/dokploy/components/dashboard/settings/oidc-sso/oidc-sso-settings.tsx` (FR-001):
  - Put it next to the admin group.
  - Help text: "Only the owner and members of this group can manage users. Leave empty to keep Dokploy's default rules. Requires an SSO login in the last 8 hours".
  - Lock it when `sources.userManagementGroup === "env"`.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T026 [P] Add benchmarks to `apps/dokploy/__test__/oidc-sso/performance.test.ts` for the three cases in quickstart §3 (NFR-PERF-001, NFR-PERF-002), and assert p95 ≤ 1 ms added and ≤ 20 ms added. Attach the results to the PR.
- [X] T027 [P] Document `SSO_OIDC_USER_MANAGEMENT_GROUP`, the 8-hour re-login rule and the new event reasons in `specs/001-keycloak-sso/operations.md` (env table, Milpia example, diagnostics) and in `specs/001-keycloak-sso/contracts/cli-and-env.md` (FR-001, FR-012, FR-015).
- [ ] T028 Run `pnpm --filter=dokploy test`, `pnpm typecheck` and `pnpm format-and-lint` (FR-013, principle IV):
  - Coverage of `packages/server/src/oidc-sso/**` must stay ≥ 90 % lines, with 100 % branches of `domain/user-management.ts` and `user-management/guard.ts`.
  - Confirm with `grep` that nothing under `/proprietary` or `audit(` is imported by the new files.
- [ ] T029 Run `/security-review` on the branch and resolve HIGH/MEDIUM findings before opening the PR (principle III, NFR-SEC-001).
- [ ] T030 Run the quickstart.md manual scenarios 1–10 against the e2e Keycloak and record the results in the PR description (SC-001, SC-002, SC-003, SC-004, SC-005).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: sin dependencias.
- **Foundational (2)**: depende de T001. Bloquea todas las stories.
- **US1 (3)** y **US2 (4)**: dependen de la fase 2. US2 reutiliza los archivos de prueba de US1,
  así que conviene hacerla después.
- **US3 (5)**: depende de la fase 2 (T006). Se puede hacer en paralelo con US1.
- **Polish (6)**: al final.

### Within Each Story

- Primero las pruebas, que deben fallar. Después la implementación.
- La guarda (T011) va antes que sus adaptadores (T016 y T017).
- El backend (T016–T018) va antes que la interfaz (T019).

### Parallel Opportunities

- Fase 2: T003, T005, T007, T009 y T012 tocan archivos distintos.
- US1: T013, T014, T015 y T031 en paralelo, y después T016 y T017 en paralelo.
- US3 (T023–T025) en paralelo con US1 una vez hecho T006.

---

## Parallel Example: User Story 1

```text
Task: "T013 tRPC middleware tests in user-management-trpc.test.ts"
Task: "T014 router drift test in user-management-drift.test.ts"
Task: "T015 better-auth hook tests in user-management-hook.test.ts"
# then
Task: "T016 tRPC middleware + trpc.ts hook point"
Task: "T017 better-auth before hook in the oidcSso plugin"
```

---

## Implementation Strategy

### MVP First

1. Fases 1 y 2.
2. Fase 3 (US1). Con eso ya se valida que un lead no gestiona usuarios por ninguna vía.
3. Fase 4 (US2), para confirmar que no se ha quitado nada a quien sí debe gestionar.

### Incremental Delivery

- **US1 + US2**: cubren la petición de infra (spec 014, punto 4). Se pueden desplegar con la
  variable definida por entorno.
- **US3**: añade el campo en la interfaz y la validación de configuración.
- **Polish**: rendimiento, documentación, revisión de seguridad y validación manual. Todo ello
  antes del PR.

---

## Notes

- Cada prueba cita en su nombre (`it("FR-006: ...")`) o en un comentario el requisito que cubre
  (principio IV).
- Commits por task o grupo lógico, con los trailers `Spec: 002-lead-user-management`,
  `Requirement:`, `Task:` y `Jira:`. La clave de Jira sale de `/sdd-sync`, que se ejecuta antes
  de implementar.
- Los hallazgos de upstream de research R10 no son tareas de esta spec. Se registran aparte si el
  owner lo decide.
