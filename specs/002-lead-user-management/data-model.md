# Data Model: Los leads operan como admin pero no gestionan usuarios

Todos los cambios son aditivos y afectan solo a tablas del módulo `oidc-sso` (principio II). Van
en una migración de Drizzle nueva, detrás de `0196_chief_goliath.sql`.

## oidc_sso_config (columna nueva)

| Columna | Tipo | Nula | Por defecto | Regla |
|---|---|---|---|---|
| `user_management_group` | text | sí | `null` | Lista separada por comas (FR-002). Mismo tratamiento que `admin_group`: se recorta, el vacío equivale a `null` y como máximo tiene 512 caracteres. `null` desactiva la funcionalidad (FR-009) |

La variable `SSO_OIDC_USER_MANAGEMENT_GROUP` prevalece sobre la columna y la bloquea en la
interfaz (FR-001).

## oidc_sso_login_state (tabla nueva)

Constancia de los grupos de un usuario en su último login por SSO (research R5).

| Columna | Tipo | Nula | Regla |
|---|---|---|---|
| `user_id` | text, PK, FK → `user.id` `ON DELETE CASCADE` | no | una fila por usuario |
| `groups` | text[] | no | Grupos normalizados por `claims.ts`, ordenados. Como máximo 100 elementos de 256 caracteres; los que sobran se descartan |
| `last_sso_login_at` | timestamp | no | Hora del servidor en el login |
| `updated_at` | timestamp | no | Igual que `last_sso_login_at`, para diagnóstico |

Ciclo de vida:
- Se crea o se sobrescribe (upsert) en cada login por SSO correcto de un usuario que no es el
  owner, dentro de la transacción de provisioning.
- No se borra al caducar: la caducidad se evalúa al leer (R6).
- Desaparece con el usuario, por la cascada.

## oidc_sso_auth_event (columnas nuevas)

| Columna | Tipo | Nula | Regla |
|---|---|---|---|
| `action` | text | sí | Solo en eventos `user_management`. Uno de los valores de `UserManagementAction` |
| `target_user_id` | text | sí | Usuario afectado, cuando la petición lo identifica. Sin FK, igual que `user_id` |

Evento nuevo:
- `type = "user_management"`
- `outcome = "denied"`
- `reason` es uno de: `no_sso_login`, `grant_expired`, `not_in_group`, `check_failed`.

## Tipos de dominio

```text
UserManagementAction =
  remove_user | remove_member | invite | create_user | resend_invitation |
  cancel_invitation | change_role | change_permissions | manage_roles

UserManagementDecision =
  { allow: true }
  | { allow: false, reason: no_sso_login | grant_expired | not_in_group | check_failed }

UserManagementInput {
  ssoActive: boolean
  userManagementGroup: string | null
  isInstanceOwner: boolean
  loginState: { groups: string[], lastSsoLoginAt: Date } | null
  now: Date
}
```

Estados de un usuario que no es el owner, con el grupo de gestión configurado:

| Estado | Condición | Puede gestionar |
|---|---|---|
| Sin constancia | nunca entró por SSO | no (`no_sso_login`) |
| Con permiso | último login SSO hace < 8 h y sus grupos coinciden | sí |
| Fuera del grupo | último login SSO hace < 8 h y sus grupos no coinciden | no (`not_in_group`) |
| Caducado | último login SSO hace ≥ 8 h | no (`grant_expired`) |

Un login por SSO lleva a «Con permiso» o a «Fuera del grupo» desde cualquier estado. El paso del
tiempo lleva de esos dos a «Caducado». Cambiar el grupo configurado reevalúa las filas existentes
sin reescribirlas.
