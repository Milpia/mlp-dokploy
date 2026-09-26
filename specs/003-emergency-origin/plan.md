# Implementation Plan: Origen permitido para el acceso de emergencia por túnel

**Branch**: `003-emergency-origin` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-emergency-origin/spec.md`

## Summary

Con `SSO_OIDC_EMERGENCY_ORIGIN` definido, el owner puede entrar desde un túnel SSH
(`http://localhost:3900`) en cualquier modo del SSO: la ruta de emergencia de la spec 001 en
SSO-only, y el login local en modo botón o con el SSO desactivado. Esto cubre el login, el segundo
factor y el cierre de sesión. El resto de peticiones desde ese origen se siguen rechazando.

**Enmienda 2026-09-26 (MIL-427, MIL-495..498):** el origen deja de depender del modo SSO-only
(R2, condición 5 retirada), el cierre de sesión del menú (`/oidc/sign-out`) entra en la lista y, por
el túnel, no redirige al proveedor (R9). Un rechazo del túnel se registra una sola vez (R4).

Enfoque técnico:
- better-auth comprueba el origen en el router, antes de los hooks de los plugins (research R1).
- Por eso el enganche es `onRequest` de nuestro plugin `oidcSso()`, que se ejecuta antes.
- Cuando se cumplen todas las condiciones de R3, sustituye en esa única petición la cabecera
  `Origin` por el origen público. Sin tocar upstream y sin listas compartidas.

Ver [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 sobre Node.js 24.4.0

**Primary Dependencies**: las ya presentes (better-auth 1.6.23, tRPC 11, Drizzle ORM, zod 4). Sin
dependencias nuevas.

**Storage**: PostgreSQL. Una columna booleana nueva en `oidc_sso_auth_event`, en una migración
aditiva.

**Testing**: Vitest 4 (unitarias de la política pura y de `onRequest` con `Request` reales),
`vitest bench` y la e2e con Keycloak 26 de la spec 001, con un origen `http://localhost:<puerto>`
simulado por cabecera.

**Target Platform**: Dokploy self-hosted (contenedor Linux).

**Project Type**: aplicación web full-stack (monorepo pnpm).

**Performance Goals**:
- Sin la variable, ≤ 1 ms p95 y ninguna consulta añadida (NFR-PERF-001).
- Con la variable, ninguna consulta añadida fuera de las 4 rutas con el origen configurado
  (NFR-PERF-002).

**Constraints**:
- Solo por variable de entorno.
- Un único origen exacto.
- Fallo cerrado: ante la duda, la petición no se toca.
- Sin código de `/proprietary`.

**Scale/Scope**: una ruta de recuperación usada en incidencias; 4 rutas de better-auth afectadas.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Comprobación | Estado |
|---|---|---|
| I. Frontera de licencia | Revisada. Todo vive en el módulo `oidc-sso`; no se usa nada de `/proprietary` ni se tocan comprobaciones de licencia | ✅ |
| II. Divergencia mínima | Desactivado por defecto: sin la variable, la lista de orígenes es la de upstream (FR-003). Ningún archivo de upstream salvo la migración generada | ✅ |
| III. Seguridad | Refuerza la vía de recuperación que exige el principio. CSRF intacto fuera de 5 rutas y del origen exacto. Fallo cerrado (NFR-SEC-002). Sin estado compartido (NFR-SEC-001). Cabecera interna no falsificable. Registro de intentos (R4). Lista ASVS en R7. Se ejecutará `/security-review` | ✅ (ver Complexity Tracking) |
| IV. Calidad y pruebas | Pruebas de los casos que no deben sustituir el origen primero. 100 % de ramas de la política. Un test por escenario de aceptación | ✅ |
| V. Trazabilidad | Spec Kit completo. Ticket bajo MIL-393 con `/sdd-sync` antes de implementar, así que los commits llevan `Jira:` | ✅ |
| VI. Rendimiento | NFR-PERF-001/002 con bench (quickstart §3) | ✅ |
| VII. Identidad consolidada | El código no fija `localhost` ni puertos; Milpia lo pone por entorno | ✅ |

### Archivos de upstream que se tocan (principio II)

| Archivo | Cambio | Por qué es imprescindible |
|---|---|---|
| `apps/dokploy/drizzle/*` | migración generada | columna `emergency_origin` |

No se tocan ni `packages/server/src/lib/auth.ts` ni `apps/dokploy/pages/index.tsx`. El plugin
`oidcSso()` ya está registrado, y la página de emergencia funciona igual en cualquier origen porque
el cliente de better-auth usa rutas relativas.

## Project Structure

### Documentation (this feature)

```text
specs/003-emergency-origin/
├── spec.md
├── plan.md              # este archivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/emergency-origin.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/server/src/
├── db/schema/oidc-sso.ts                   # + oidc_sso_auth_event.emergency_origin
└── oidc-sso/
    ├── config/env.ts                       # + emergencyOrigin con validación (R5)
    ├── domain/emergency-origin.ts          # nuevo: decideEmergencyOrigin (pura, R3)
    ├── events/auth-events.ts               # + emergencyOrigin
    └── plugin/
        ├── index.ts                        # + onRequest
        ├── emergency-origin.ts             # nuevo: onRequest (lee cuerpo, sustituye Origin, registra)
        └── sso-only-guard.ts               # hook after: marca emergency_origin

apps/dokploy/
├── server/api/routers/oidc-sso.ts          # get: + emergencyOrigin (solo lectura)
├── components/dashboard/settings/oidc-sso/
│   ├── oidc-sso-settings.tsx               # muestra el origen en la sección de emergencia
│   └── sso-auth-events.tsx                 # marca «via emergency origin»
└── __test__/oidc-sso/                      # unitarias, bench, e2e
```

**Structure Decision**: mismo reparto que la spec 001. La regla es una función pura en `domain/`.
El adaptador a better-auth (`plugin/emergency-origin.ts`) solo traduce `Request` ↔ entrada de la
política y construye la petición sustituta.

### Patrones aplicados

- **Policy (función pura)**: `decideEmergencyOrigin`, con tabla de verdad completa.
- **Decorator de petición**: la copia sustituta cambia solo `Origin` y `Referer` y añade la marca
  interna.
- **Fail-closed**: cualquier excepción devuelve la petición original.
- **Fast path**: sin variable o sin coincidencia de origen, sale sin leer nada.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| El plugin reescribe la cabecera `Origin` de ciertas peticiones antes del control CSRF de better-auth (principio III: toca una protección de seguridad) | better-auth valida el origen en el router, antes de cualquier hook (R1). Es la única forma de aceptar un origen extra solo en 5 rutas y solo para el owner, sin tocar upstream | Ampliar `trustedOrigins` globalmente lo aceptaría en todas las rutas (condición 1 de infra). Editar `resolveTrustedOrigins` en `auth.ts` toca upstream y duplica la lógica del owner. Desactivar CSRF por ruta lo abriría a cualquier origen |
| El cuerpo de `/sign-in/email` se lee dos veces (un `clone()` en `onRequest`) | Comprobar el email del owner antes del router (FR-004) | Aceptar cualquier email y dejar que la guarda rechace cambiaría el error de los no-owner de «origen» a «SSO obligatorio», y FR-004 pide no aceptar el origen para ellos. El coste es un JSON pequeño, solo en esa ruta y con el origen coincidente |
