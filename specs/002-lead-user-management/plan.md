# Implementation Plan: Los leads operan como admin pero no gestionan usuarios

**Branch**: `002-lead-user-management` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-lead-user-management/spec.md`

## Summary

Un ajuste nuevo del SSO, el grupo de gestión de usuarios, decide quién puede borrar, invitar,
cambiar roles o permisos y gestionar roles: el owner de la instancia y los admins que están en ese
grupo, con un login por SSO en las últimas 8 horas. En Milpia el grupo es `admins`, así que los
leads siguen siendo `admin` para todo lo demás.

Enfoque técnico:
- **Política pura** `decideUserManagement` en el módulo `oidc-sso`, con fallo cerrado (R4).
- **Constancia de grupos**: una tabla nueva que el provisioning de la spec 001 rellena en cada
  login (R5).
- **Dos puntos de control** con la misma política:
  - un middleware tRPC encadenado en `protectedProcedure` (R2);
  - un hook `before` de nuestro plugin de better-auth para `/api/auth/organization/*` (R3). Esas
    rutas saltan tRPC y hoy están abiertas a cualquier admin.
- **Interfaz**: oculta las acciones de gestión y avisa cuando el permiso caduca (R8).

Ver [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 sobre Node.js 24.4.0

**Primary Dependencies**: las ya presentes (better-auth 1.6.23, tRPC 11, Drizzle ORM, zod 4,
Next.js 16). Sin dependencias nuevas.

**Storage**: PostgreSQL. Una tabla nueva (`oidc_sso_login_state`) y tres columnas opcionales en
tablas del módulo, todo en una migración aditiva.

**Testing**: Vitest 4 con PGlite para los adaptadores, `vitest bench` y la e2e con Keycloak 26 de la
spec 001.

**Target Platform**: Dokploy self-hosted (contenedor Linux).

**Project Type**: aplicación web full-stack (monorepo pnpm).

**Performance Goals**:
- ≤ 1 ms p95 y ninguna consulta añadida sin la funcionalidad o fuera de los paths de gestión
  (NFR-PERF-001).
- ≤ 20 ms p95 añadidos por acción de gestión (NFR-PERF-002).

**Constraints**:
- Nada de roles personalizados, de `audit()` ni de otro código bajo `/proprietary`.
- Fallo cerrado ante cualquier error.
- Sin cambios en las tablas de upstream.

**Scale/Scope**: una instancia y una organización, con decenas o cientos de usuarios. Siete
procedimientos tRPC y siete rutas de better-auth quedan protegidos.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Comprobación | Estado |
|---|---|---|
| I. Frontera de licencia | Revisada. No se usan roles personalizados, porque `resolveRole` exige licencia enterprise. No se invoca `audit()`, que llama a `createAuditLog` bajo `/proprietary`; se usan los eventos del módulo (R7). Con licencia enterprise el SSO queda inactivo y la guarda también (regla 1 de R4) | ✅ |
| II. Divergencia mínima | Desactivado por defecto: sin grupo configurado, comportamiento idéntico (FR-009). Solo tablas del módulo. Tres archivos de upstream, listados abajo | ✅ |
| III. Seguridad | Control en el servidor en las dos superficies. Lista de permitidos. Fallo cerrado (NFR-SEC-001). Reautenticación a las 8 h. Registro de denegaciones. Lista ASVS en R11. Se ejecutará `/security-review` | ✅ |
| IV. Calidad y pruebas | Pruebas de denegación primero. 100 % de ramas de `decideUserManagement`. Prueba de deriva sobre `appRouter` (R2). Un test por escenario de aceptación, con la e2e para US1 y US2 | ✅ |
| V. Trazabilidad | Spec Kit completo. Ticket bajo MIL-393 con `/sdd-sync` tras `/speckit-tasks`, así que los commits llevan `Jira:` desde el principio | ✅ |
| VI. Rendimiento | NFR-PERF-001/002 cuantificados. La configuración sale de la caché existente. Se medirá con bench (quickstart §3) | ✅ |
| VII. Identidad consolidada | Los grupos deciden. El código no fija `admins` ni `leads`; Milpia los pone por entorno (contracts/env.md) | ✅ |

### Archivos de upstream que se tocan (principio II)

| Archivo | Cambio | Por qué es imprescindible |
|---|---|---|
| `apps/dokploy/server/api/trpc.ts` | encadenar `userManagementGuard` en `protectedProcedure` (import y `.use`) | único punto común a los siete procedimientos (R2) |
| `apps/dokploy/components/dashboard/settings/users/show-users.tsx` | combinar `canManageUsers` con `canChangeRole`, `canEditPermissions`, `canRemove` y `canDelete` | FR-007: esas acciones se deciden aquí |
| `apps/dokploy/pages/dashboard/settings/users.tsx` | ocultar `ShowInvitations` y mostrar el aviso de caducidad | FR-007 |
| `apps/dokploy/drizzle/*` | migración generada | obligatoria para la tabla y las columnas nuevas |

`packages/server/src/lib/auth.ts` no se toca: el hook de R3 vive en nuestro plugin, que ya está
registrado ahí.

## Project Structure

### Documentation (this feature)

```text
specs/002-lead-user-management/
├── spec.md
├── plan.md              # este archivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── user-management-guard.md
│   └── env.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/server/src/
├── db/schema/oidc-sso.ts                  # + oidc_sso_login_state, + columnas
└── oidc-sso/
    ├── domain/user-management.ts          # nuevo: decideUserManagement, acciones, TTL (puro)
    ├── identity/
    │   ├── provisioning.ts                # + recordLoginState en la transacción
    │   └── login-state.ts                 # nuevo: lectura y upsert de la constancia
    ├── user-management/
    │   ├── guard.ts                       # nuevo: checkUserManagement (política + evento)
    │   └── paths.ts                       # nuevo: mapas tRPC y better-auth → acción
    ├── config/{env,repository,provider}.ts # + userManagementGroup
    ├── events/auth-events.ts              # + action, targetUserId
    └── plugin/
        ├── index.ts                       # + hook de gestión de usuarios
        └── user-management-hook.ts        # nuevo: hook before de /organization/*

apps/dokploy/
├── server/api/
│   ├── trpc.ts                            # upstream: .use(userManagementGuard)
│   ├── middlewares/user-management.ts     # nuevo: middleware tRPC
│   └── routers/oidc-sso.ts                # + userManagementStatus, + campo en get/update
├── components/dashboard/settings/oidc-sso/oidc-sso-settings.tsx  # + campo del grupo
├── components/dashboard/settings/oidc-sso/user-management-visibility.ts  # nuevo: helper puro de visibilidad
├── components/dashboard/settings/users/show-users.tsx            # upstream
├── pages/dashboard/settings/users.tsx                            # upstream
└── __test__/oidc-sso/                     # unitarias, integración, deriva, bench, e2e
```

**Structure Decision**:
- La regla vive en el dominio de `oidc-sso`, que no conoce ni tRPC ni better-auth.
- Hay dos adaptadores finos, uno por superficie. Los dos llaman a `checkUserManagement`, que
  combina la política con el registro del evento.
- Así la decisión y el evento son idénticos se entre por donde se entre.

### Patrones aplicados

- **Policy (función pura)**: `decideUserManagement`, con tabla de verdad completa en pruebas.
- **Ports & adapters**: `LoginStateStore` y `AuthEventStore` son interfaces, lo que permite probar
  la guarda sin BD.
- **Chokepoint**: un único control por superficie, en lugar de comprobaciones repartidas por los
  handlers.
- **Fail-closed**: cualquier excepción produce `check_failed`.
- **Lista cerrada con prueba de deriva**: protege frente a cambios de upstream en los routers.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Middleware global en `protectedProcedure` que mira el path de todas las llamadas tRPC | Un único punto de enganche para siete procedimientos, que además cubre los futuros que la prueba de deriva detecte | Siete cambios repartidos por dos routers multiplican la divergencia. El coste fuera de los paths de gestión es una búsqueda en un `Set` (NFR-PERF-001) |
| Los admins del grupo de gestión siguen pudiendo saltarse, por `/api/auth/organization/*`, las reglas de upstream entre admins (R10) | Corregirlo cambiaría el comportamiento de upstream para todas las instancias (principio II) y queda fuera del alcance de la spec | Se reporta como hallazgo aparte para decidir si va a upstream o a otra spec |
