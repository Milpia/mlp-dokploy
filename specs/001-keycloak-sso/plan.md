# Implementation Plan: SSO con Keycloak para la edición free

**Branch**: `001-oidc-sso` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-oidc-sso/spec.md`

## Summary

La instancia self-hosted podrá usar Keycloak (OIDC) como proveedor de identidad, en modo
**botón** o **SSO-only**, con provisioning y roles derivados de grupos de Keycloak, dos vías de
emergencia y configuración por interfaz o por variables de entorno.

Enfoque técnico:
- **Plugin propio de better-auth** (`oidcSso()`), en un módulo nuevo e independiente de
  `/proprietary`.
- **Validación OIDC** delegada en `openid-client` v6 (certificado): PKCE, `state`, `nonce` y
  validación del ID token.
- **Configuración** en una tabla propia, con caché en memoria e invalidación al guardar.
- **Política de acceso** como función pura.
- **Provisioning** atómico en una transacción.

Ver [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 sobre Node.js 24.4.0

**Primary Dependencies**:
- Ya presentes: better-auth 1.6.23, Next.js 16 (pages router, servidor propio), tRPC 11,
  Drizzle ORM 0.45 y zod 4.
- **Nueva**: `openid-client` ^6 (R2).

**Storage**: PostgreSQL, con 2 tablas nuevas (`oidc_sso_config`, `oidc_sso_auth_event`) y
una migración de Drizzle aditiva.

**Testing**: Vitest 4 (`apps/dokploy/__test__`), `@vitest/coverage-v8` para la cobertura y
`vitest bench` para el rendimiento. Las pruebas e2e usan Keycloak 26 en Docker.

**Target Platform**: Dokploy self-hosted (contenedor Linux).

**Project Type**: aplicación web full-stack (monorepo pnpm).

**Performance Goals**:
- ≤ 5 ms p95 añadidos con el SSO desactivado.
- ≤ 300 ms p95 de trabajo propio por login.
- 50 logins concurrentes.

**Constraints**:
- Timeout de 5 s hacia Keycloak.
- La configuración se lee sin consultar la BD en cada petición.
- Ningún import de `/proprietary`.

**Scale/Scope**: una instancia y una organización, con decenas o cientos de usuarios.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Comprobación | Estado |
|---|---|---|
| I. Frontera de licencia | Módulo nuevo `packages/server/src/oidc-sso/`. No se importa nada de `/proprietary`: ni `@better-auth/sso` en sus wrappers, ni `audit-log`, ni `license-key`. La precedencia enterprise se detecta con columnas de la tabla `user` de upstream (R14) | ✅ |
| II. Divergencia mínima | El modo por defecto es `disabled`. Tablas nuevas, sin tocar las de upstream. Los archivos de upstream que se tocan están listados y justificados abajo | ✅ (ver Complexity Tracking por `proxy.ts`) |
| III. Seguridad | Lista ASVS L2 / RFC 9700 en research R16. Secreto cifrado. Fallo cerrado (R7). Dos vías de recuperación (R11). Eventos registrados (R12). Rate limit (R13). Se ejecutará `/security-review` | ✅ |
| IV. Calidad y pruebas | Pruebas primero en los caminos de denegación. Cobertura ≥ 90 % líneas / 85 % ramas del módulo. Un test por escenario de aceptación (unitario más e2e opcional) | ✅ |
| V. Trazabilidad | Spec Kit completo. Commits con trailers `Spec/Requirement/Task/Jira`. `traceability.yaml` local con `jira: null`; el trailer `Jira:` se añade tras `/sdd-sync` (excepción temporal, ver tasks.md › Notes) | ✅ |
| VI. Rendimiento | Objetivos NFR-PERF cuantificados. Caché de configuración y de cliente OIDC. Timeouts. Benchmarks con `vitest bench` | ✅ |

### Archivos de upstream que se tocan (principio II)

| Archivo | Cambio | Por qué es imprescindible |
|---|---|---|
| `packages/server/src/lib/auth.ts` | añadir `oidcSso()` a `plugins` | único punto de registro de plugins |
| `packages/server/src/db/schema/index.ts` | `export * from "./oidc-sso"` | Drizzle y el adaptador de better-auth leen el esquema desde aquí |
| `packages/server/package.json` | dependencia `openid-client` | R2 |
| `apps/dokploy/server/api/root.ts` | registrar `oidcSso` | registro de routers |
| `apps/dokploy/pages/index.tsx` | botón, redirección SSO-only, aviso de emergencia y mensajes de error | pantalla de login única |
| `apps/dokploy/components/layouts/user-nav.tsx` | logout que pasa por `/api/auth/oidc/sign-out` en SSO-only | FR-010 |
| `apps/dokploy/components/layouts/side.tsx` | entrada de menú «Keycloak SSO» (solo owner, no cloud) | navegación a la configuración |
| `apps/dokploy/esbuild.config.ts`, `apps/dokploy/package.json` | entrada y script del comando de emergencia | patrón de `reset-password` |
| `apps/dokploy/drizzle/*` | migración generada | obligatorio para las tablas nuevas |
| `apps/dokploy/package.json` (dev) | `@vitest/coverage-v8`, `@electric-sql/pglite` | cobertura (NFR-QA-001) y pruebas de los adaptadores con Postgres real |
| `apps/dokploy/__test__/vitest.config.ts` | bloque `coverage` limitado al módulo | umbrales de cobertura del principio IV |

> Implementación: el barrel `packages/server/src/index.ts` no se tocó. Los consumidores importan
> `@dokploy/server/oidc-sso/...` por subruta, lo que evita colisiones de nombres en el barrel
> y reduce la divergencia.

## Project Structure

### Documentation (this feature)

```text
specs/001-oidc-sso/
├── spec.md
├── plan.md              # este archivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── http-endpoints.md
│   ├── trpc-oidc-sso.md
│   └── cli-and-env.md
├── checklists/requirements.md
├── traceability.yaml    # trazabilidad local (sin sincronizar con Jira)
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/server/src/
├── db/schema/oidc-sso.ts           # tablas oidc_sso_config, oidc_sso_auth_event
└── oidc-sso/                       # módulo de dominio (sin dependencias de UI)
    ├── index.ts                        # API pública del módulo
    ├── types.ts                        # tipos de dominio y códigos de error
    ├── config/
    │   ├── env.ts                      # lectura y validación de SSO_OIDC_*
    │   ├── repository.ts               # acceso a oidc_sso_config (cifrado del secreto)
    │   └── provider.ts                 # merge env > db, caché TTL, estado activo, invalidación
    ├── domain/
    │   ├── access-policy.ts            # decideAccess (pura)
    │   ├── claims.ts                   # normalización de claims y grupos (pura)
    │   ├── return-to.ts                # sanitizeReturnTo (pura)
    │   └── mode-transition.ts          # reglas de cambio de modo (pura)
    ├── oidc/
    │   └── client.ts                   # adaptador de openid-client: caché por huella, timeouts
    ├── identity/
    │   └── provisioning.ts             # vincular, crear o actualizar rol en una transacción
    ├── events/
    │   └── auth-events.ts              # registro, retención y consulta de eventos
    └── plugin/
        ├── index.ts                    # oidcSso(): endpoints, hooks, rateLimit
        ├── endpoints.ts                # sign-in, callback, sign-out
        └── sso-only-guard.ts           # hook before/after de rutas locales

apps/dokploy/
├── server/api/routers/oidc-sso.ts   # router tRPC (publicConfig, get, update, testConnection, listEvents)
├── proxy.ts                             # añade returnTo en /dashboard/* sin cookie de sesión
├── pages/dashboard/settings/oidc-sso.tsx
├── components/dashboard/settings/oidc-sso/
│   ├── oidc-sso-settings.tsx        # formulario, prueba de conexión, selector de modo
│   └── sso-auth-events.tsx         # tabla de eventos recientes
├── components/auth/sign-in-with-sso.tsx
├── scripts/oidc-sso-disable-sso-only.ts
└── __test__/oidc-sso/               # unitarias, bench, e2e (con KEYCLOAK_E2E=1)
```

**Structure Decision**:
- **Dominio en `packages/server`**: vive en un módulo propio (`oidc-sso/`), ordenado en
  capas: dominio puro → adaptadores (OIDC, repositorio) → orquestación (plugin). Las
  dependencias apuntan hacia el dominio, y el dominio no conoce ni better-auth ni Drizzle.
- **UI y API en `apps/dokploy`**: siguen las convenciones existentes (routers tRPC,
  componentes por sección de settings, páginas con `getServerSideProps`).
- **Pruebas**: van en `apps/dokploy/__test__`, donde vive la configuración de Vitest del
  monorepo.

### Patrones aplicados

- **Ports & adapters**: `OidcClient` y `ConfigRepository` son interfaces. El plugin recibe sus
  implementaciones, lo que permite probar el callback sin red ni BD.
- **Strategy / políticas puras**: `decideAccess` y `canTransitionMode` son deterministas y
  concentran las reglas de negocio.
- **Cache-aside con invalidación explícita**: en el proveedor de configuración y en el
  cliente OIDC, con huella de configuración.
- **Unit of work**: la transacción de provisioning.
- **Fail-closed**: toda rama no prevista termina en denegación con un código estable.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `apps/dokploy/proxy.ts` nuevo que actúa en todas las rutas `/dashboard/*` y añade `?returnTo=` a la redirección aunque el SSO esté desactivado (roza el principio II) | US2 escenario 3: volver a la página pedida tras el login. Las 46 páginas redirigen a `/` por su cuenta | Modificar las 46 páginas multiplica la divergencia. El proxy solo mira si existe la cookie (sin BD, microsegundos), y la página de login ignora `returnTo` en modo desactivado, así que el flujo visible es idéntico salvo el parámetro en la URL |
| Trailer `Jira:` omitido temporalmente en los commits (principio V) | Las issues de Jira aún no existen: el usuario pidió no tocar Jira hasta revisar | Poner claves inventadas haría que Jira enlazara commits a issues equivocadas. Los trailers `Spec/Requirement/Task` y `traceability.yaml` (`jira: null`) permiten añadir la clave al sincronizar con `/sdd-sync` |
| Dependencia nueva `openid-client` | Validación OIDC certificada (NFR-SEC-001/002) | Implementarla a mano con `jose` es código criptográfico propio y más superficie de fallo |
