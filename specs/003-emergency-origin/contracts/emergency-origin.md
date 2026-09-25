# Contrato: origen de emergencia

## Variable de entorno

| Variable | Formato | Ejemplo (Milpia) | Por defecto |
|---|---|---|---|
| `SSO_OIDC_EMERGENCY_ORIGIN` | un origen exacto: `http(s)://host[:puerto]`, sin barra final | `http://localhost:3900` | sin definir: ningún origen extra |

Si el valor no es válido, se escribe al arrancar:
`OIDC SSO: SSO_OIDC_EMERGENCY_ORIGIN must be an exact http(s) origin without path or wildcards`.
El valor se ignora.

## Rutas afectadas (`POST /api/auth…`)

Solo con SSO-only activo y con `Origin` (o, si falta, el origen de `Referer`) igual al configurado:

| Ruta | Condición adicional | Resultado |
|---|---|---|
| `/sign-in/email` | `email` del owner | se procesa como si viniera del origen público; lo decide la guarda de emergencia de la spec 001 |
| `/sign-in/email` | otro email | intacta (better-auth responde 403 `INVALID_ORIGIN`); se registra `emergency_login` / `denied` / `not_owner` con `emergency_origin = true` |
| `/two-factor/verify-totp`, `/two-factor/verify-backup-code` | ninguna | se procesa como si viniera del origen público; la cookie firmada `two_factor` sigue siendo obligatoria |
| `/sign-out` | ninguna | se procesa como si viniera del origen público |
| cualquier otra | — | intacta |

La cabecera interna `x-oidc-sso-emergency-origin` se borra siempre de las peticiones que llegan de
fuera. Solo la pone el plugin.

## Eventos

`emergency_login` gana el campo `emergencyOrigin: boolean` en `oidcSso.listEvents`. La tabla de
eventos de la pantalla de SSO lo muestra como «via emergency origin».

## `oidcSso.get`

Añade `emergencyOrigin: string | null`, de solo lectura. `update` no lo acepta.
