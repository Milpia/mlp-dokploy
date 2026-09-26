# Contrato: variables de entorno y comando de emergencia

## Variables de entorno

| Variable | Valores | Efecto |
|---|---|---|
| `SSO_OIDC_MODE` | `disabled` \| `button` \| `sso-only` | fuerza el modo |
| `SSO_OIDC_ISSUER_URL` | URL | issuer del proveedor (en Keycloak, la URL del realm) |
| `SSO_OIDC_CLIENT_ID` | texto | |
| `SSO_OIDC_CLIENT_SECRET` | texto | secreto (prevalece sobre `_FILE`) |
| `SSO_OIDC_CLIENT_SECRET_FILE` | ruta | secreto leído de un archivo (Docker secret o Vault Agent) |
| `SSO_OIDC_ACCESS_GROUP` | texto o lista separada por comas | p. ej. `admins,leads` |
| `SSO_OIDC_ADMIN_GROUP` | texto o lista separada por comas | p. ej. `admins` |
| `SSO_OIDC_GROUPS_CLAIM` | texto | claim con grupos o roles (por defecto `groups`; Zitadel: `urn:zitadel:iam:org:project:roles`) |
| `SSO_OIDC_EXTRA_SCOPES` | scopes separados por espacios | se añaden a `openid email profile` (p. ej. `groups`) |
| `SSO_OIDC_BUTTON_LABEL` | texto | |
| `SSO_OIDC_ALLOW_INSECURE_HTTP` | `true` \| `false` | solo en desarrollo |
| `SSO_OIDC_EMERGENCY_ORIGIN` | origen exacto `http(s)://host[:puerto]`, sin barra final | origen extra aceptado solo para el login del owner, su segundo factor y el cierre de sesión, en cualquier modo del SSO (spec 003, `specs/003-emergency-origin/contracts/emergency-origin.md`). Un valor inválido se ignora y se registra en el log |
| `SSO_OIDC_USER_MANAGEMENT_GROUP` | texto o lista separada por comas, máx. 512 caracteres | solo el owner y los miembros de este grupo pueden gestionar usuarios, con un login por SSO de hace menos de 8 horas (spec 002, `specs/002-lead-user-management/contracts/user-management-guard.md`). Vacía o sin definir, rigen las reglas de upstream. Un valor demasiado largo se ignora y se registra en el log |

- Un valor no válido (p. ej. un modo desconocido) se ignora: se registra un error al arrancar y
  se usa el valor guardado.
- Una variable vacía se trata como no definida.
- `SSO_OIDC_MODE=sso-only` fuerza el modo, pero **no** se salta la verificación de FR-011:
  si nadie ha verificado el issuer, la instancia se comporta como `button` y registra un aviso.
  Así, una variable mal puesta no puede dejar la instancia inaccesible.

## Comando `sso:disable-sso-only`

```
pnpm --filter=dokploy run sso:disable-sso-only
# en el contenedor:
node -r dotenv/config dist/oidc-sso-disable-sso-only.mjs
```

| Situación | Salida | Código |
|---|---|---|
| El modo guardado era `sso-only` | `SSO-only mode disabled. The instance is now in button mode.` | 0 |
| El modo guardado no era `sso-only` | `SSO-only mode was not enabled. Nothing to do.` | 0 |
| `SSO_OIDC_MODE=sso-only` en el entorno | además: `Warning: SSO_OIDC_MODE=sso-only is set in the environment; remove it and restart for the change to apply.` | 2 |
| Error de BD | mensaje de error | 1 |

En todos los casos registra un evento `mode_change` con `reason = "emergency_command"`.
