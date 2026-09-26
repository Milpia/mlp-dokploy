# Implementation Plan: Compatibilidad verificada con siete proveedores OIDC

**Branch**: `004-oidc-provider-compatibility` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-oidc-provider-compatibility/spec.md`

## Summary

El módulo `oidc-sso` (spec 001) pasa a estar **verificado** con Keycloak, Okta, Auth0, Authentik, Zitadel, FusionAuth y Authelia.

Enfoque técnico:
- **Cambios en el módulo**, genéricos y pequeños:
  - completar `email` y `email_verified` desde la información de usuario cuando faltan en el ID token (research R1);
  - dos presets nuevos (Auth0 y FusionAuth).
- **Batería e2e común**, parametrizada por proveedor:
  - Dokploy sigue en proceso, con el `auth.handler` real de better-auth;
  - el login del proveedor lo completa un navegador sin interfaz (`playwright-core`), con un conductor pequeño por proveedor.
- **Entornos:**
  - instancias efímeras en Docker con semilla declarativa para los 5 autoalojables;
  - scripts de siembra idempotentes contra la Management API para los tenants de prueba de Okta y Auth0, en modo opt-in.
- **Matriz:** resultados en JSON versionados y una matriz generada. CI semanal y a demanda para los 5 autoalojables.

Ver [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 sobre Node.js 24.4.0

**Primary Dependencies**:
- Ya presentes: better-auth 1.6.23, `openid-client` 6.8.8, Vitest 4.
- **Nueva (dev)**: `playwright-core`, con Chromium instalado aparte (R3). No entra en la imagen de producción.

**Storage**: ninguno nuevo. Los resultados son archivos JSON en `specs/004-oidc-provider-compatibility/results/`.

**Testing**:
- Vitest para las unidades de R1.
- Batería e2e con Vitest y `playwright-core`, lanzada por el runner. No forma parte de `pnpm test` (NFR-QA-002).

**Target Platform**: pruebas en macOS o Linux con Docker. En CI, `ubuntu-latest`.

**Project Type**: aplicación web (monorepo pnpm). Esta spec añade sobre todo tooling de pruebas.

**Performance Goals**:
- menos de 10 minutos por proveedor autoalojable (NFR-QA-001);
- ninguna llamada extra a la información de usuario si el ID token ya trae los tres claims (NFR-PERF-001).

**Constraints**:
- sin código de módulo específico de un proveedor (FR-007, SC-006);
- instancias efímeras que solo escuchan en `127.0.0.1`;
- credenciales SaaS solo por entorno;
- nada de `/proprietary`.

**Scale/Scope**: 7 proveedores, 8 escenarios cada uno. Unos 5 archivos de semilla y 7 conductores.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Comprobación | Estado |
|---|---|---|
| I. Frontera de licencia | Revisada: todo es código del módulo o tooling de pruebas. No usa el SSO enterprise ni nada de `/proprietary` | ✅ |
| II. Divergencia mínima | Solo el módulo y archivos propios. De upstream se toca únicamente `apps/dokploy/package.json`: la dependencia de desarrollo y dos scripts | ✅ |
| III. Seguridad | La información de usuario nunca sustituye un claim del ID token. Un `sub` distinto deniega el login. Las credenciales SaaS solo van por entorno, redactadas. La prueba de conexión se verifica por proveedor (FR-011). Se ejecutará `/security-review` sobre el cambio del módulo | ✅ |
| IV. Calidad y pruebas | Instancias efímeras o tenants dedicados, nunca entornos de Milpia. Pruebas de denegación incluidas (`access-denied`, `connection-test-bad`). Pruebas unitarias primero para R1 | ✅ |
| V. Trazabilidad | Spec Kit completo. Story bajo MIL-393 con `/sdd-sync` antes de implementar | ✅ |
| VI. Rendimiento | NFR-PERF-001 cubierto con una prueba que cuenta las llamadas a la información de usuario. NFR-QA-001 lo mide el runner | ✅ |
| VII. Identidad consolidada | El módulo sigue sin nombrar proveedores. Los presets, las guías y las pruebas no son código del módulo (SC-006) | ✅ |
| Restricciones técnicas | Dependencia nueva justificada en R3 (`playwright-core`, solo de desarrollo) | ✅ |

### Archivos de upstream que se tocan (principio II)

| Archivo | Cambio | Por qué es imprescindible |
|---|---|---|
| `apps/dokploy/package.json` | `playwright-core` en devDependencies y los scripts `e2e:oidc` y `e2e:oidc:matrix` | punto de registro de dependencias y scripts |
| `pnpm-lock.yaml` | la dependencia nueva | obligatorio |

## Project Structure

### Documentation (this feature)

```text
specs/004-oidc-provider-compatibility/
├── spec.md
├── plan.md                  # este archivo
├── research.md              # Phase 0
├── data-model.md            # Phase 1
├── quickstart.md            # Phase 1
├── contracts/runner-and-env.md
├── checklists/requirements.md
├── results/<provider>.json  # lo escribe el runner (FR-014)
├── limitations.md           # se escribe a mano
├── compatibility.md         # generado (FR-010)
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
packages/server/src/oidc-sso/
└── oidc/client.ts                      # R1: email / email_verified desde userinfo

apps/dokploy/
├── components/dashboard/settings/oidc-sso/provider-presets.ts   # + Auth0, FusionAuth
├── scripts/
│   ├── oidc-providers.ts               # runner: entorno, batería, resultados, limpieza
│   └── oidc-compat-matrix.ts           # genera compatibility.md
└── __test__/oidc-sso/
    ├── oidc-client.test.ts             # + pruebas de R1
    └── providers/
        ├── README.md                   # qué son los secretos de prueba
        ├── harness.ts                  # Dokploy en proceso + navegador + page.route
        ├── battery.e2e.test.ts         # escenarios de FR-004
        ├── keycloak/   { compose.yml, realm.json, driver.ts }
        ├── authentik/  { compose.yml, blueprint.yaml, driver.ts }
        ├── zitadel/    { compose.yml, seed.ts, driver.ts }
        ├── fusionauth/ { compose.yml, kickstart.json, driver.ts }
        ├── authelia/   { compose.yml, configuration.yml, users_database.yml, driver.ts }
        ├── okta/       { seed.ts, driver.ts }
        └── auth0/      { seed.ts, action.js, driver.ts }

.github/workflows/milpia-oidc-providers.yml   # CI semanal y a demanda (R7)
specs/001-keycloak-sso/operations.md          # guías por proveedor + enlace a la matriz
specs/001-keycloak-sso/spec.md                # FR-022 remite a la spec 004 (FR-012)
```

**Structure Decision**:
- El único cambio del módulo es genérico y está en su adaptador OIDC.
- Todo lo específico de cada proveedor vive en `__test__/oidc-sso/providers/<id>/` y en la documentación.
- El runner y el generador de la matriz son scripts de la app, como `oidc-sso-disable-sso-only.ts`.

### Patrones aplicados

- **Strategy**: un `ProviderDriver` por proveedor detrás de una batería única, para que los resultados sean comparables.
- **Test harness in-process**: Dokploy corre como `auth.handler` y el navegador se enruta hacia él con `page.route`, sin servidor ni puertos.
- **Ephemeral environment + try/finally**: el entorno se destruye siempre.
- **Generated documentation**: la matriz es una vista de los resultados, nunca una fuente editada a mano.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Dependencia de desarrollo nueva `playwright-core` y descarga de Chromium | Cinco de los siete proveedores usan SPA o flujos multipaso para el login (R2, R3) | Simular con `fetch` obliga a reimplementar la API privada de cada proveedor, y es frágil ante sus actualizaciones |
| Secretos de prueba versionados (clientes, contraseñas y claves de las instancias efímeras) | La siembra declarativa desde el repo (FR-009) necesita valores fijos | Generarlos en cada ejecución complicaría las semillas estáticas (realm JSON, blueprint, `kickstart.json`). Solo protegen contenedores efímeros en `127.0.0.1`, y un README lo explica |
