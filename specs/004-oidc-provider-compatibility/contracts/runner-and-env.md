# Contrato: runner de verificaciones y variables

## Comandos (`apps/dokploy/package.json`)

| Comando | Efecto |
|---|---|
| `pnpm run e2e:oidc <id>` | Verifica un proveedor: levanta su entorno (autoalojables), ejecuta la batería, escribe `results/<id>.json` y destruye el entorno siempre |
| `pnpm run e2e:oidc all` | Verifica los 7 en secuencia. Los SaaS sin credenciales se omiten y se informa |
| `pnpm run e2e:oidc:matrix` | Regenera `specs/004-oidc-provider-compatibility/compatibility.md` |

Código de salida:
- **0:** todos los proveedores ejecutados pasan, o se omiten;
- **1:** algún proveedor falla;
- **2:** error del propio runner, por ejemplo Docker no disponible.

Salida: una línea por proveedor con `passed`, `failed` o `skipped (faltan: VAR1, VAR2)` y la ruta del archivo de resultados.

## Variables

| Variable | Uso | Obligatoria |
|---|---|---|
| `OIDC_E2E_PROVIDER` | La pone el runner para la batería. No se define a mano | — |
| `OKTA_E2E_ORG_URL`, `OKTA_E2E_API_TOKEN` | Tenant de pruebas de Okta: URL y token de la Management API para sembrar | para Okta |
| `AUTH0_E2E_DOMAIN`, `AUTH0_E2E_MGMT_CLIENT_ID`, `AUTH0_E2E_MGMT_CLIENT_SECRET` | Tenant de pruebas de Auth0: aplicación M2M con acceso a la Management API | para Auth0 |
| `OIDC_E2E_SAAS_PASSWORD` | Contraseña de los usuarios de prueba que la semilla crea en los tenants SaaS | para Okta y Auth0 |

Las credenciales SaaS nunca se escriben en archivos, logs ni resultados. El runner redacta sus valores de cualquier mensaje de error que guarde.

## CI: `.github/workflows/milpia-oidc-providers.yml`

- **Disparadores:** `workflow_dispatch` y `schedule` semanal.
- **Matriz:** `keycloak`, `authentik`, `zitadel`, `fusionauth` y `authelia`.
- **Por job:** instala las dependencias y Chromium, ejecuta `pnpm run e2e:oidc <id>` y sube `results/<id>.json` como artefacto.
- **Permisos:** `contents: read`. No escribe en el repo.
