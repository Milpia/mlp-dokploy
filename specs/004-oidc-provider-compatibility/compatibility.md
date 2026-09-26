# Matriz de compatibilidad OIDC

<!-- Generado por `pnpm --filter=dokploy run e2e:oidc:matrix` desde results/*.json y limitations.md. No editar a mano. -->

Cada fila resume la última verificación del proveedor con la batería común de la spec 004 (FR-004).

| Proveedor | Versión | Fecha | Entorno | Commit | Alta por grupo | Rol admin | Denegación | Cambio de rol | Cierre de sesión | Conexión OK | Secreto malo | Gestión de usuarios (002) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Keycloak | 26.7.4 | 2026-09-26 | local | f8b7726 | pasa | pasa | pasa | pasa | pasa | pasa | pasa | pasa |
| Okta | — | 2026-09-26 | — | — | no verificado (faltan: OKTA_E2E_ORG_URL, OKTA_E2E_API_TOKEN, OIDC_E2E_SAAS_PASSWORD) | — | — | — | — | — | — | — |
| Auth0 | — | 2026-09-26 | — | — | no verificado (faltan: AUTH0_E2E_DOMAIN, AUTH0_E2E_MGMT_CLIENT_ID, AUTH0_E2E_MGMT_CLIENT_SECRET, OIDC_E2E_SAAS_PASSWORD) | — | — | — | — | — | — | — |
| Authentik | 2026.8.3 | 2026-09-26 | local | f8b7726 | pasa | pasa | pasa | pasa | pasa | pasa | pasa | pasa |
| Zitadel | v4.19.0 | 2026-09-26 | local | f8b7726 | pasa | pasa | pasa | pasa | pasa | pasa | pasa | pasa |
| FusionAuth | 1.69.2 | 2026-09-26 | local | f8b7726 | pasa | pasa | pasa | pasa | pasa | pasa | pasa | pasa |
| Authelia | 4.39.28 | 2026-09-26 | local | f8b7726 | pasa | pasa | pasa | pasa | pasa (sin fin de sesión en el proveedor) | pasa | pasa | pasa |

## Limitaciones conocidas

### Keycloak

- Ninguna conocida. El mapper de grupos del ejemplo no incluye la ruta (`full.path=false`); con ruta, Dokploy acepta `/grupo` y `grupo` por igual.

### Okta

- **No verificado: sin tenant de pruebas.** La semilla y el conductor existen, pero no se han ejecutado. El campo del filtro de grupos del servidor de autorización de la organización en la API está marcado como [verificar].

### Auth0

- **No verificado: sin tenant de pruebas.** La semilla y el conductor existen, pero no se han ejecutado.
- Auth0 no tiene claim de grupos: los roles llegan por una Action Post-Login a un claim con namespace (`https://dokploy/groups`).
- El fin de sesión RP-initiated depende de una opción del tenant. Sin ella, Dokploy muestra su pantalla de sesión cerrada.

### Authentik

- `email_verified` es `false` por defecto. Hace falta un scope mapping propio para `email` que lo ponga a `true`.
- Desde 2025.x, cada proveedor debe tener `authorization_code` entre sus grant types permitidos.
- Tras el fin de sesión, Authentik muestra su propia página de sesión cerrada y no devuelve el navegador a Dokploy.
- Authentik mira el código antes de autenticar al cliente, así que la prueba de conexión usa el endpoint de revocación (automático desde la spec 004).

### Zitadel

- Verificado con el login v1 del servidor. Login V2 no cambia el flujo OIDC, pero no se ha ejecutado.
- Los roles del proyecto hacen de grupos: claim `urn:zitadel:iam:org:project:roles` y scope del mismo nombre, con «assert roles on authentication» activado.

### FusionAuth

- El issuer del tenant viene con un valor de ejemplo y hay que fijarlo a la URL pública.
- Los roles de aplicación solo llegan al ID token con la política de scopes de la aplicación en «Compatibility».
- No tiene endpoint de revocación: la prueba de conexión usa el código inventado, que distingue bien el secreto.

### Authelia

- Sin fin de sesión RP-initiated (authelia#5057): Dokploy muestra su pantalla de sesión cerrada.
- Requiere HTTPS y un dominio de cookie con punto (no `localhost`).
- Sin `claims_policy`, los grupos, el email y `email_verified` solo llegan por userinfo, que Dokploy consulta automáticamente (FR-005).
- Su endpoint de revocación solo acepta autenticación Basic por defecto; la prueba de conexión lo reintenta así.
