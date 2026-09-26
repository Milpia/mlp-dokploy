# Quickstart: verificar un proveedor OIDC

El contrato está en [contracts/runner-and-env.md](./contracts/runner-and-env.md) y los formatos en [data-model.md](./data-model.md).

## Requisitos previos

- El entorno de desarrollo del fork: Node 24.4.0 y `pnpm install`.
- Docker con `docker compose`.
- Chromium para Playwright, una sola vez: `pnpm --filter=dokploy exec playwright-core install chromium`.
- Para Okta y Auth0: un tenant de desarrollo **solo para pruebas** y las variables de la tabla del contrato.

## 1. Un proveedor autoalojable

```bash
pnpm --filter=dokploy run e2e:oidc keycloak
```

Resultado esperado:
- en menos de 10 minutos, `keycloak: passed` y `specs/004-oidc-provider-compatibility/results/keycloak.json` actualizado;
- `docker ps` no muestra ningún contenedor del proveedor al terminar, pase o falle.

Repetir con `authentik`, `zitadel`, `fusionauth` y `authelia`.

## 2. Todos, sin credenciales SaaS

```bash
pnpm --filter=dokploy run e2e:oidc all
```

Esperado: los 5 autoalojables ejecutados, y `okta: skipped (faltan: OKTA_E2E_ORG_URL, OKTA_E2E_API_TOKEN, ...)` y `auth0: skipped (...)`. Código de salida 0 si los 5 pasan (SC-005).

## 3. Okta y Auth0

```bash
export OKTA_E2E_ORG_URL=... OKTA_E2E_API_TOKEN=... OIDC_E2E_SAAS_PASSWORD=...
pnpm --filter=dokploy run e2e:oidc okta
```

La semilla es idempotente, así que se puede repetir. Después, `grep -r "$OKTA_E2E_API_TOKEN" specs/` no debe encontrar nada (FR-008).

## 4. Matriz

```bash
pnpm --filter=dokploy run e2e:oidc:matrix
git diff specs/004-oidc-provider-compatibility/compatibility.md
```

Esperado: la tabla refleja los resultados recién escritos, con versión, fecha y resultado por escenario. Las limitaciones salen de `limitations.md`.

## 5. Guía de operación (SC-002)

Un operador sigue la sección del proveedor en `specs/001-keycloak-sso/operations.md` con una instancia limpia, sin mirar el código ni las semillas, y cronometra el tiempo hasta que entra un usuario del grupo de acceso. Objetivo: menos de 30 minutos.

## 6. CI

En Actions → «Milpia OIDC providers» → Run workflow: los 5 jobs terminan y cada uno sube su `results/<id>.json` como artefacto.
