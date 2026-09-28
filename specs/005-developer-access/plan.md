# Implementation Plan: Los developers entran por SSO con su perfil y solo a sus proyectos

**Branch**: `005-developer-access` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-developer-access/spec.md`

## Summary

En cada login por SSO, un member que pertenece a un grupo con perfil recibe en las columnas de
upstream de `member` los permisos y el alcance que define su grupo:
- **Permisos:** los 11 booleanos.
- **Alcance:** los proyectos por nombre, los entornos filtrados por nombre y todos sus servicios.

Todo ocurre dentro de la transacción de alta que ya existe (R1, R2). Una tabla del módulo,
`oidc_sso_member_profile`, deja constancia del origen, para poder revocar al salir del grupo y avisar
en la lista de usuarios (R3). La configuración es un único JSON, `groupProfiles`, por variable o
desde la pantalla de SSO, y el entorno manda (R4).

La caducidad a las 8 horas del último login por SSO se aplica en un middleware tRPC encadenado en
`protectedProcedure`. Revoca en la base de datos la primera vez que la detecta y solo cuesta una
consulta en las peticiones de members con perfil (R6).

Las comprobaciones de upstream no cambian: leen de `member` como siempre.

## Technical Context

**Language/Version**: TypeScript 5 sobre Node.js 24.4.0

**Primary Dependencies**: las que ya hay (better-auth 1.6.23, tRPC 11, Drizzle ORM, zod 4, Next.js 16). Ninguna nueva.

**Storage**: PostgreSQL. Una tabla nueva (`oidc_sso_member_profile`) y una columna opcional
(`oidc_sso_config.group_profiles`), en una migración aditiva detrás de la `0197`. Se escriben columnas
de upstream de `member`, pero su esquema no cambia.

**Testing**: Vitest 4, con PGlite para los adaptadores y la resolución de alcance, `vitest bench`, y la
e2e con Keycloak de la spec 001 para US1, US2 y US4.

**Target Platform**: Dokploy self-hosted, en un contenedor Linux de un solo proceso.

**Project Type**: aplicación web full-stack (monorepo pnpm).

**Performance Goals**:
- ≤ 50 ms p95 añadidos al login con perfil (NFR-PERF-001).
- ≤ 5 ms p95 por petición de un member con perfil, y ninguna consulta para owner, admins y members sin perfil (NFR-PERF-002).

**Constraints**:
- Nada de roles personalizados ni de código bajo `/proprietary`.
- Fallo cerrado ante cualquier error.
- Ningún permiso que upstream reserve a admin (FR-008).
- Esquema de upstream intacto.

**Scale/Scope**: una instancia y una organización, con decenas o cientos de usuarios. Como máximo
20 grupos con perfil y 200 proyectos por grupo (R10).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Comprobación | Estado |
|---|---|---|
| I. Frontera de licencia | Revisada. Solo se escriben los permisos individuales de member, que son de la parte libre (`getLegacyOverrides`). No se usan roles personalizados ni `audit()`. Con un rol personalizado no se aplica perfil (R8), y con licencia enterprise el SSO queda inactivo | ✅ |
| II. Divergencia mínima | Desactivado por defecto: sin `groupProfiles`, el comportamiento es idéntico (FR-013). Solo tablas y columnas del módulo. Los archivos de upstream que se tocan están listados abajo | ✅ |
| III. Seguridad | Control en el servidor, a través de las comprobaciones de upstream (R2). Mínimo privilegio. Fallo cerrado (NFR-SEC-001). Caducidad a 8 h (R6). Eventos y línea de log. Lista ASVS en R11. Se ejecutará `/security-review` | ✅ |
| IV. Calidad y pruebas | Pruebas de denegación primero. Tabla de R3 y validación al 100 % de ramas. Prueba de deriva de la guarda. Un test por escenario de aceptación y la e2e para US1, US2 y US4 | ✅ |
| V. Trazabilidad | Spec Kit completo. Ticket bajo MIL-393 con `/sdd-sync` tras `/speckit-tasks`, así que los commits llevan `Jira:` desde el principio | ✅ |
| VI. Rendimiento | NFR-PERF-001 y 002 cuantificados. Caché en memoria para la guarda (R6). Bench en quickstart §3 | ✅ |
| VII. Identidad consolidada | Los grupos deciden. El código no fija `developers` ni ningún proyecto; Milpia los pone por entorno (contracts/env.md) | ✅ |

### Archivos de upstream que se tocan (principio II)

| Archivo | Cambio | Por qué es imprescindible |
|---|---|---|
| `apps/dokploy/server/api/trpc.ts` | encadenar `memberProfileGuard` en `protectedProcedure`, junto a `userManagementGuard` | único punto común a todas las peticiones de un member (R6) |
| `apps/dokploy/components/dashboard/settings/users/show-users.tsx` | montar la insignia «SSO: <grupos>» | FR-011 |
| `apps/dokploy/components/dashboard/settings/users/add-permissions.tsx` | montar el aviso de que los cambios se sobrescriben | FR-011 |
| `apps/dokploy/pages/dashboard/projects.tsx` | montar el aviso de perfil caducado | FR-017 |
| `apps/dokploy/server/wss/authorize.ts` | llamar a `checkMemberProfileExpiryForUser` antes de autorizar un WebSocket de contenedor | FR-017: las WebSockets no pasan por tRPC (hallazgo de T033) |
| `apps/dokploy/__test__/wss/authorize.test.ts` | simular el módulo de caducidad | sus tests prueban la autorización de upstream; la caducidad se prueba en `__test__/oidc-sso` |
| `apps/dokploy/drizzle/*` | migración generada | obligatoria para la tabla y la columna nuevas |

## Project Structure

### Documentation (this feature)

```text
specs/005-developer-access/
├── spec.md
├── plan.md              # este archivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── env.md
│   └── trpc-and-guard.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/server/src/
├── db/schema/oidc-sso.ts                  # + oidc_sso_member_profile, + group_profiles
└── oidc-sso/
    ├── domain/
    │   ├── group-profiles.ts              # nuevo: validación y unión de perfiles (puro)
    │   └── user-management.ts             # TTL compartido (SSO_GRANT_TTL_MS)
    ├── member-profile/
    │   ├── apply.ts                       # nuevo: applyGroupProfile (tabla de R3)
    │   ├── scope.ts                       # nuevo: resolveScope + puerto ScopeCatalog
    │   ├── store.ts                       # nuevo: adaptador Drizzle (member + tabla nueva)
    │   └── expiry.ts                      # nuevo: checkMemberProfileExpiry + caché
    ├── identity/provisioning.ts           # + applyGroupProfile en la transacción
    ├── config/{env,repository,provider}.ts # + groupProfiles
    ├── admin/config-admin.ts              # + validación y env_locked de groupProfiles
    └── types.ts                           # + ConfigField, tipos de eventos

apps/dokploy/
├── server/api/
│   ├── trpc.ts                            # upstream: .use(memberProfileGuard)
│   ├── middlewares/member-profile.ts      # nuevo: middleware tRPC
│   └── routers/oidc-sso.ts                # + groupProfiles, + 3 queries
├── components/dashboard/settings/oidc-sso/
│   ├── oidc-sso-settings.tsx              # + campo JSON y resultado de groupProfilesCheck
│   ├── member-profile-badge.tsx           # nuevo
│   └── member-profile-notice.tsx          # nuevo: avisos de sobrescritura y de caducidad
├── components/dashboard/settings/users/{show-users,add-permissions}.tsx  # upstream
├── pages/dashboard/projects.tsx           # upstream
└── __test__/oidc-sso/                     # unitarias, PGlite, deriva, bench, e2e
```

**Structure Decision**:
- **Dominio puro.** La regla (validación, unión y tabla de R3) vive en el dominio de `oidc-sso`, sin conocer tRPC ni Drizzle.
- **Adaptadores.** El alta y la guarda son adaptadores finos.
- **Upstream.** Solo se tocan puntos de montaje.

### Patrones aplicados

- **Policy (función pura):** la validación de `groupProfiles` y la decisión de R3, con tabla de verdad completa en pruebas.
- **Ports & adapters:** `ScopeCatalog`, `MemberProfileStore` y `LoginStateStore`, para probar sin base de datos.
- **Chokepoint:** un único punto para aplicar (el alta) y otro para caducar (la guarda).
- **Revocación perezosa:** la caducidad se escribe una vez en la base de datos, y después upstream decide sin saber nada del perfil.
- **Fail-closed:**
  - un error en el alta deshace el login;
  - un error en la guarda deniega la petición.

## Complexity Tracking

Ningún principio se incumple, así que no hay nada que justificar.
