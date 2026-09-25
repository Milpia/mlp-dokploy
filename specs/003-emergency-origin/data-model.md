# Data Model: Origen permitido para el acceso de emergencia por túnel

## Configuración (sin persistencia)

| Campo | Origen | Regla |
|---|---|---|
| `emergencyOrigin` | variable `SSO_OIDC_EMERGENCY_ORIGIN` | Origen exacto: `http` o `https`, host y puerto opcional. Además, `new URL(v).origin === v`, sin `*`, sin ruta ni consulta (research R5). Un valor inválido se trata como no definido y se registra en `env.errors`. No hay columna en la BD ni campo en la interfaz |

## oidc_sso_auth_event (columna nueva)

| Columna | Tipo | Nula | Por defecto | Regla |
|---|---|---|---|---|
| `emergency_origin` | boolean | no | `false` | `true` si el intento llegó por el origen de emergencia (research R4). Solo se usa en eventos `emergency_login` |

La migración de Drizzle es aditiva y va después de la última de `canary`
(`0197_lying_hitman.sql`). Si la spec 002 se mergea antes, esta migración se regenera después de
la suya (ver la nota sobre el orden de migraciones de MIL-433).

## Decisión de sustitución (tipo de dominio)

```text
EmergencyOriginInput {
  configuredOrigin: string | null
  method: string
  requestOrigin: string | null      // Origin, o el origen de Referer
  path: string                      // relativa al basePath de better-auth
  ssoOnlyActive: boolean
  email: string | null              // solo /sign-in/email
  ownerEmail: string | null
}

EmergencyOriginDecision =
  { rewrite: true }
  | { rewrite: false, recordDenied: boolean }   // recordDenied: /sign-in/email con email que no es el owner
```
