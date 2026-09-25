# Contrato: variables de entorno y comando de emergencia

## Variables de entorno

| Variable | Valores | Efecto |
|---|---|---|
| `KEYCLOAK_SSO_MODE` | `disabled` \| `button` \| `sso-only` | fuerza el modo |
| `KEYCLOAK_SSO_ISSUER_URL` | URL | issuer del realm |
| `KEYCLOAK_SSO_CLIENT_ID` | texto | |
| `KEYCLOAK_SSO_CLIENT_SECRET` | texto | secreto (prevalece sobre `_FILE`) |
| `KEYCLOAK_SSO_CLIENT_SECRET_FILE` | ruta | secreto leído de un archivo (Docker secret o Vault Agent) |
| `KEYCLOAK_SSO_ACCESS_GROUP` | texto | |
| `KEYCLOAK_SSO_ADMIN_GROUP` | texto | |
| `KEYCLOAK_SSO_BUTTON_LABEL` | texto | |
| `KEYCLOAK_SSO_ALLOW_INSECURE_HTTP` | `true` \| `false` | solo en desarrollo |

- Un valor no válido (p. ej. un modo desconocido) se ignora: se registra un error al arrancar y
  se usa el valor guardado.
- Una variable vacía se trata como no definida.
- `KEYCLOAK_SSO_MODE=sso-only` fuerza el modo, pero **no** se salta la verificación de FR-011:
  si nadie ha verificado el issuer, la instancia se comporta como `button` y registra un aviso.
  Así, una variable mal puesta no puede dejar la instancia inaccesible.

## Comando `keycloak:disable-sso-only`

```
pnpm --filter=dokploy run keycloak:disable-sso-only
# en el contenedor:
node -r dotenv/config dist/keycloak-sso-disable-sso-only.mjs
```

| Situación | Salida | Código |
|---|---|---|
| El modo guardado era `sso-only` | `Keycloak SSO-only mode disabled. The instance is now in button mode.` | 0 |
| El modo guardado no era `sso-only` | `Keycloak SSO-only mode was not enabled. Nothing to do.` | 0 |
| `KEYCLOAK_SSO_MODE=sso-only` en el entorno | además: `Warning: KEYCLOAK_SSO_MODE=sso-only is set in the environment; remove it and restart for the change to apply.` | 2 |
| Error de BD | mensaje de error | 1 |

En todos los casos registra un evento `mode_change` con `reason = "emergency_command"`.
