# Implementation Plan: Solo lectura por entorno para qa y para ver producción

**Branch**: `006-read-only-access` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-read-only-access/spec.md`

## Summary

Cada perfil de grupo de la 005 admite una clave nueva, `readOnly`: `true` para todos sus entornos o
una lista de nombres (R1).

**En el login:**
- La unión de grupos calcula los entornos de solo lectura como los que ningún grupo da con acceso completo (R2).
- Se guardan, con sus servicios y proyectos, en `oidc_sso_member_profile` y en una caché en memoria (R3).
- Esos entornos siguen en el alcance de upstream, que deja verlos.

**En cada petición:** un middleware nuevo, `readOnlyGuard`, encadenado en `protectedProcedure` detrás de
la guarda de caducidad, resta la escritura (R4):
- **Mutaciones y suscripciones:** las clasifica con un registro que cubre todo `appRouter` y deniega por defecto. Una prueba de deriva obliga a clasificar cada procedimiento nuevo de upstream (R5).
- **Queries:** oculta los valores secretos objeto a objeto, así que en la misma respuesta un developer ve su staging y no los secretos de producción (R6).

**WebSocket** (R7), para los members con perfil de grupo:
- **Terminal y logs de contenedor:** se comprueba que el contenedor pertenece al servicio por el que se piden.
- **Terminal en solo lectura:** en los servicios de solo lectura, la terminal se deniega.
- **Logs de despliegue:** se ligan al alcance y a la caducidad.
- **Terminal del servidor:** se deniega a quien tenga algún entorno de solo lectura.

**Interfaz:** un componente del módulo, `ReadOnlyBoundary`, muestra la insignia y desactiva las
pestañas de cambio (R10).

## Technical Context

**Language/Version**: TypeScript 5 sobre Node.js 24.4.0

**Primary Dependencies**: las que ya hay (better-auth 1.6.23, tRPC 11.10, Drizzle ORM, zod 4, Next.js 16, dockerode y ssh2 para la inspección de la terminal). Ninguna nueva.

**Storage**: PostgreSQL, con una migración aditiva `0199` detrás de `0198_spicy_blackheart`:
- tres columnas `text[]` en `oidc_sso_member_profile`;
- una columna `resource_id` en `oidc_sso_auth_event`.

Ninguna tabla de upstream cambia.

**Testing**: Vitest 4:
- unitarias puras para la validación, la unión, el registro y `redact`;
- PGlite para `lookup` y el guardado;
- las pruebas de deriva (cadena, registro y columnas secretas);
- `vitest bench`;
- la e2e con Keycloak de la spec 001 para US1 y US2.

**Target Platform**: Dokploy self-hosted, en un contenedor Linux de un solo proceso.

**Project Type**: aplicación web full-stack (monorepo pnpm).

**Performance Goals** (NFR-PERF-001, R12):
- **Mutación de un member con solo lectura:** ≤ 5 ms p95 añadidos.
- **Sin consultas añadidas:** en las lecturas, en owner y admins, en members sin perfil y en members sin solo lectura.
- **`redact`:** ≤ 5 ms p95 sobre `project.all` con 200 proyectos.

**Constraints**:
- Nada de roles personalizados ni de código bajo `/proprietary`.
- Fallo cerrado: una mutación sin regla, un id ausente o un error deniegan.
- Esquema de upstream intacto.
- Sin `readOnly` configurado, el comportamiento es el de la 005 (FR-012).

**Scale/Scope**: una instancia y una organización. Como máximo:
- 20 grupos, con 20 entornos de solo lectura por grupo;
- cientos de servicios;
- unas 390 mutaciones y suscripciones tRPC que clasificar (y 236 queries), contadas en `3d9bfd345` e incluidos los routers enterprise. Unas 230 actúan sobre servicios.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Comprobación | Estado |
|---|---|---|
| I. Frontera de licencia | Revisada. No usa roles personalizados ni `customRole`. Los routers enterprise (`sso`, `scim`, `licenseKey`, `whitelabeling`, `customRole`, `auditLog`) solo se clasifican por nombre en el registro, sin leer ni importar su código. Con licencia enterprise, el SSO del módulo queda inactivo y la guarda sale en el paso 2 | ✅ |
| II. Divergencia mínima | Desactivado por defecto: sin `readOnly`, la guarda sale sin coste (FR-012). Solo columnas del módulo. Archivos de upstream listados abajo, todos puntos de montaje | ✅ |
| III. Seguridad | Control en el servidor por todas las vías (R4, R7). Fallo cerrado con registro que deniega por defecto (R5). Secretos ocultos con prueba de deriva de columnas (R6). Eventos sin emails (R9). Lista ASVS en R11. Riesgo residual de secretos ya vistos documentado con rotación en la quickstart (R6-a). Se ejecutará `/security-review` | ✅ |
| IV. Calidad y pruebas | Pruebas de denegación primero, citando FR. 100 % de las reglas del registro y de las decisiones de `redact`. Tres pruebas de deriva. Un test por escenario de aceptación, y la e2e para US1 y US2 | ✅ |
| V. Trazabilidad | Spec Kit completo. Ticket bajo el Epic maestro con `/sdd-sync` tras `/speckit-tasks`, con los trailers desde el primer commit | ✅ |
| VI. Rendimiento | NFR-PERF-001 cuantificado por camino (R12), caché en memoria con recarga a 5 min (R3) y bench en la quickstart §3 | ✅ |
| VII. Identidad consolidada | Los grupos deciden. El código no fija `qa`, `developers` ni `production`; Milpia los pone por entorno (contracts/env.md) | ✅ |

### Archivos de upstream que se tocan (principio II)

| Archivo | Cambio | Por qué es imprescindible |
|---|---|---|
| `apps/dokploy/server/api/trpc.ts` | encadenar `readOnlyGuard` después de `memberProfileGuard` | único punto común a la interfaz y a la API con clave (R4) |
| `apps/dokploy/server/wss/docker-container-terminal.ts`, `docker-container-logs.ts` | llamar a `checkContainerBinding` después de `canAccessDockerOverWss` | no pasan por tRPC (R7, FR-004b) |
| `apps/dokploy/server/wss/listen-deployment.ts` | llamar a `checkDeploymentLogAccess` antes de abrir el `tail` | no pasa por tRPC (R7, FR-004c) |
| `apps/dokploy/server/wss/terminal.ts` | llamar a la caducidad de la 005 y a la comprobación `unbound` | shell del servidor, fuera de tRPC (R7) |
| `apps/dokploy/__test__/wss/*.test.ts` | simular el módulo de solo lectura | sus tests prueban la autorización de upstream; la solo lectura se prueba en `__test__/oidc-sso` |
| `apps/dokploy/pages/dashboard/project/[projectId]/environment/[environmentId]/services/{application,compose,postgres,mysql,mariadb,mongo,redis,libsql}/[*Id].tsx` | montar `ReadOnlyBoundary` alrededor de las pestañas de cambio | FR-010 (R10). Solo envoltorios, sin cambiar lógica |
| `apps/dokploy/drizzle/*` | migración generada | obligatoria para las columnas nuevas |

## Project Structure

### Documentation (this feature)

```text
specs/006-read-only-access/
├── spec.md
├── plan.md              # este archivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── env.md
│   └── guard-and-redaction.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/server/src/
├── db/schema/oidc-sso.ts                    # + 3 columnas en member_profile, + resource_id
└── oidc-sso/
    ├── domain/group-profiles.ts             # + readOnly: validación y unión (puro)
    ├── member-profile/
    │   ├── scope.ts                         # + ReadOnlyScope en resolveScope
    │   ├── store.ts                         # + escribe y vacía las tres listas
    │   ├── cache.ts                         # + readOnlyScopeCache
    │   └── status.ts                        # + readOnly en memberProfileStatus
    ├── read-only/
    │   ├── policy.ts                        # nuevo: READ_ONLY_POLICY y evaluate (puro)
    │   ├── lookup.ts                        # nuevo: puerto SubResourceOwner + adaptador Drizzle
    │   ├── secret-fields.ts                 # nuevo: SECRET_FIELDS y clasificación de columnas
    │   ├── redact.ts                        # nuevo: redact (puro)
    │   └── wss.ts                           # nuevo: checkContainerBinding, checkDeploymentLogAccess, inspección
    ├── events/auth-events.ts                # + resourceId
    └── types.ts                             # + readOnly en GroupProfile, razones de evento

apps/dokploy/
├── server/api/
│   ├── trpc.ts                              # upstream: .use(readOnlyGuard)
│   ├── middlewares/read-only.ts             # nuevo: middleware tRPC
│   └── routers/oidc-sso.ts                  # + readOnly en status y en groupProfilesCheck
├── server/wss/{docker-container-terminal,docker-container-logs,listen-deployment,terminal}.ts   # upstream: una llamada cada uno
├── components/dashboard/settings/oidc-sso/
│   ├── oidc-sso-settings.tsx                # + aviso de entornos de solo lectura no encontrados
│   └── read-only-boundary.tsx               # nuevo
├── pages/dashboard/project/.../services/*/[*Id].tsx   # upstream: montaje
└── __test__/oidc-sso/                       # unitarias, PGlite, deriva, bench, e2e
```

**Structure Decision**:
- **Dominio puro.** La regla vive en `oidc-sso/read-only` sin conocer tRPC ni Drizzle: validación, unión, registro, evaluación y ocultación.
- **Adaptadores.** El middleware, la terminal y `lookup` son adaptadores finos.
- **Upstream.** Solo se tocan puntos de montaje.

### Patrones aplicados

- **Policy + Registry (funciones puras):** `READ_ONLY_POLICY` es datos, y `evaluate(rule, input, scope)` es una función pura con tabla de verdad completa en pruebas.
- **Deny by default + drift test:** un procedimiento sin regla se deniega, y CI falla hasta clasificarlo (R5).
- **Ports & adapters:** `SubResourceOwner` (para `lookup`) y `ContainerInspector` (para la terminal), para probar sin base de datos ni Docker.
- **Chokepoint:** un único middleware para tRPC y la API con clave, y una llamada por WebSocket de escritura.
- **Output filter:** la ocultación se aplica a la respuesta en el mismo middleware, objeto a objeto, sin tocar los routers.
- **Fail-closed:** cualquier error en la guarda, en `lookup` o en la inspección deniega.

## Hallazgos de la investigación

Al investigar aparecieron dos problemas de seguridad en las conexiones WebSocket, que esta spec
cierra para los members con perfil de grupo (Clarifications, FR-004b y FR-004c). La caducidad de la
005 tampoco se comprobaba en `/terminal`. El detalle del problema de seguridad está en el repositorio privado `Milpia/mlp-dokploy-security` (MIL-545, MIL-546).

## Complexity Tracking

Ningún principio se incumple. Hay una complejidad que conviene justificar:

| Decisión | Por qué hace falta | Alternativa más simple descartada |
|---|---|---|
| Un registro que cubre todos los procedimientos de `appRouter`, con prueba de deriva | upstream no tiene una única comprobación por servicio, y varias mutaciones no comprueban nada (R4, R5) | engancharse a `checkServicePermissionAndAccess`: deja huecos y toca un archivo de upstream muy usado |
| Ocultación por objeto en las respuestas | la misma respuesta mezcla entornos completos y de solo lectura (`project.one`) | denegar las queries: rompe FR-002 |
