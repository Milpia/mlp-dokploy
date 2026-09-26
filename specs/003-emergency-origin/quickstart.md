# Quickstart: validar el origen de emergencia

El contrato está en [contracts/emergency-origin.md](./contracts/emergency-origin.md).

## Requisitos previos

- El entorno y el Keycloak efímero de la e2e de la spec 001.
- Dokploy arrancado con:

```dotenv
BETTER_AUTH_URL=https://deploy.example.test
SSO_OIDC_MODE=sso-only
SSO_OIDC_EMERGENCY_ORIGIN=http://localhost:3900
```

- El panel accesible en `http://localhost:3900`, bien con `ssh -L 3900:127.0.0.1:3000` contra un
  servidor, bien con un proxy local que reenvíe al 3000.
- El owner verificado (FR-011 de la spec 001), con y sin 2FA para los escenarios 2 y 3.

## 1. Pruebas automáticas

```bash
pnpm --filter=dokploy test -- oidc-sso
KEYCLOAK_E2E=1 pnpm --filter=dokploy test -- oidc-sso/e2e
pnpm --filter=dokploy exec vitest bench oidc-sso
```

## 2. Escenarios manuales

| # | Pasos | Resultado esperado | Cubre |
|---|---|---|---|
| 1 | Abrir `http://localhost:3900/?emergency=1` y entrar con el owner (sin 2FA) | llega al panel | US1-1, FR-004 |
| 2 | Igual, con el owner con 2FA; introducir el TOTP | llega al panel | US1-2, FR-005 |
| 3 | Igual, con un código de respaldo | llega al panel | FR-005 |
| 4 | Cerrar sesión desde el menú | vuelve al login del túnel, sin pasar por el proveedor, y la sesión desaparece | US1-4, FR-009 |
| 5 | Entrar con un usuario que no es el owner | 403; un solo evento `not_owner` con `emergency origin` | US2-1, FR-006, FR-007 |
| 6 | Con sesión de owner por el túnel, pedir un restablecimiento de contraseña o cambiar la contraseña | 403 (`INVALID_ORIGIN` o «Single sign-on is required») | US2-2 |
| 7 | Pasar a modo botón, cerrar sesión y repetir los pasos 1, 4 y 5 | el owner entra y sale; el otro usuario recibe 403 y queda registrado una vez | US1-5, US2-3 |
| 8 | Quitar la variable y repetir el paso 1 en SSO-only | 403 `INVALID_ORIGIN`, igual que hoy | US3-1, FR-003 |
| 9 | Poner `SSO_OIDC_EMERGENCY_ORIGIN=http://localhost:3900/` y arrancar | error en el log; el paso 1 da 403 | US3-2, FR-002 |
| 10 | El owner abre la pantalla de SSO › eventos | aparecen los intentos 1–5 marcados como emergencia | US1-3, FR-007 |

## 3. Rendimiento

Bench de `onRequest` en tres casos: sin variable, con variable y un origen distinto, y con
variable en una ruta de emergencia. Objetivos: NFR-PERF-001/002.
