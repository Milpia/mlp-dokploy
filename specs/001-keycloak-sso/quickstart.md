# Quickstart: validar el SSO con Keycloak en local

## Requisitos

- Node 24.4.0 (`.nvmrc`), pnpm 10 y Docker.
- Dokploy en desarrollo: `pnpm install`, `pnpm run dokploy:setup`, `pnpm run dokploy:dev`
  (ver `CONTRIBUTING.md`).
- Un owner ya registrado en `http://localhost:3000/register`.

## 1. Levantar un Keycloak efímero

```bash
docker run --rm -d --name kc-dev -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  -v "$PWD/apps/dokploy/__test__/oidc-sso/e2e/realm-dokploy-test.json:/opt/keycloak/data/import/realm.json" \
  quay.io/keycloak/keycloak:26.0 start-dev --import-realm
```

El realm `dokploy-test` incluye:
- **El cliente `dokploy`**: confidencial, con secreto `dokploy-secret`, URL de retorno
  `http://localhost:3000/api/auth/oidc/callback` y mapper *Group Membership* sobre el
  claim `groups`.
- **Los grupos** `dokploy-users` y `dokploy-admins`.
- **Los usuarios (contraseña `Passw0rd!`)**:

  | Usuario | Grupos |
  |---|---|
  | `owner@example.com` | ninguno |
  | `admin@example.com` | los dos |
  | `dev@example.com` | `dokploy-users` |
  | `outsider@example.com` | ninguno |

  Usa como `owner@example.com` el mismo email que el owner de Dokploy.

## 2. Modo botón (US1, US3)

1. Entra como owner y ve a **Settings → Keycloak SSO**.
2. Rellena:
   - issuer: `http://localhost:8080/realms/dokploy-test`
   - cliente: `dokploy`
   - secreto: `dokploy-secret`
   - activa **Allow insecure HTTP**
   - grupo de acceso: `dokploy-users`
   - grupo de administración: `dokploy-admins`
3. Pulsa **Test connection** → ✅.
4. Guarda con el modo **Button**.
5. En una ventana privada, abre `/`: aparecen el formulario y el botón.
6. Entra con `dev@example.com` → aterrizas en `/dashboard/home` como member.
7. Entra con `admin@example.com` → rol admin.
8. Entra con `outsider@example.com` → vuelves a `/` con el error «no tienes acceso».

## 3. Modo SSO-only (US2)

1. Como owner, pulsa **Sign in with Keycloak** una vez con `owner@example.com`. Queda
   verificado (FR-011).
2. Cambia a **SSO-only**.
3. En una ventana privada, abre `/dashboard/projects`: te redirige a Keycloak, y tras el login
   vuelves a `/dashboard/projects`.
4. Pulsa **Log out**: se cierra la sesión también en Keycloak, y al volver a `/` ves de nuevo
   el formulario de Keycloak.
5. Prueba `POST /api/auth/sign-in/email` con un usuario que no es el owner → `403`.

## 4. Emergencias (US4)

1. `docker stop kc-dev` y abre `/` → página de error con **Retry**, sin bucles.
2. Abre `/?emergency=1` e inicia sesión con el email y la contraseña del owner → entras.
3. Con otra cuenta local → rechazada.
4. `pnpm --filter=dokploy run sso:disable-sso-only` → el modo pasa a Button.

## 5. Variables de entorno (FR-019/020)

Añade `SSO_OIDC_ISSUER_URL=...` en `apps/dokploy/.env` y reinicia. El campo aparece
bloqueado con la etiqueta «from environment».

## 6. Pruebas automáticas

```bash
pnpm --filter=dokploy exec vitest --config __test__/vitest.config.ts run oidc-sso
pnpm --filter=dokploy exec vitest --config __test__/vitest.config.ts run oidc-sso --coverage   # NFR-QA-001
pnpm --filter=dokploy exec vitest --config __test__/vitest.config.ts bench oidc-sso            # NFR-PERF-001/002
KEYCLOAK_E2E=1 pnpm --filter=dokploy exec vitest --config __test__/vitest.config.ts run oidc-sso/e2e   # NFR-QA-002
```

Resultado esperado: todo en verde, con cobertura ≥ 90 % de líneas y ≥ 85 % de ramas en
`packages/server/src/oidc-sso/**`.
