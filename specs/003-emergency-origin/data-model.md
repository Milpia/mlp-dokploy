# Data Model: Origen permitido para el acceso de emergencia por túnel

## Configuración (sin persistencia)

| Campo | Origen | Regla |
|---|---|---|
| `emergencyOrigin` | variable `SSO_OIDC_EMERGENCY_ORIGIN` | Origen exacto: `http` o `https`, host y puerto opcional. Además, `new URL(v).origin === v`, sin `*`, sin ruta ni consulta (research R5). Un valor inválido se trata como no definido y se registra en `env.errors`. No hay columna en la BD ni campo en la interfaz |

## oidc_sso_auth_event (columna nueva)

| Columna | Tipo | Nula | Por defecto | Regla |
|---|---|---|---|---|
| `emergency_origin` | boolean | no | `false` | `true` si el intento llegó por el origen de emergencia (research R4). Solo se usa en eventos `emergency_login` |

La migración de Drizzle es aditiva. Tras rehacer el fork sobre el tag `v0.30.7` de Dokploy (decisión del
owner, 2026-09-26), las tablas de Milpia y esta columna viven en una sola migración,
`0196_chief_goliath.sql`, justo detrás de la última de `v0.30.7` (`0195`). La historia anterior, con
las migraciones `0197` y `0198`, queda en el tag `archive/canary-upstream-base`.

## Decisión de sustitución (tipo de dominio)

```text
EmergencyOriginInput {
  configuredOrigin: string | null
  method: string
  requestOrigin: string | null      // Origin, o el origen de Referer
  path: string                      // relativa al basePath de better-auth
  email: string | null              // solo /sign-in/email
  ownerEmail: string | null
}

EmergencyOriginDecision =
  { rewrite: true }
  | { rewrite: false, recordDenied: boolean }   // recordDenied: /sign-in/email con email que no es el owner
```
