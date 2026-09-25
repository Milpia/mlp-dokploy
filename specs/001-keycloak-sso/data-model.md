# Data Model: SSO por OIDC

Todos los cambios de esquema son **aditivos** (principio II): dos tablas nuevas y ningún cambio en
tablas de upstream. Se reutilizan `user`, `account`, `member` y `session` tal como están.

## Tabla nueva `oidc_sso_config` (una fila)

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | text PK | nanoid |
| `mode` | text | `disabled` \| `button` \| `sso-only`; default `disabled` (FR-002) |
| `issuerUrl` | text, nullable | URL absoluta; `https:` salvo `allowInsecureHttp` (NFR-SEC-004) |
| `clientId` | text, nullable | 1–255 caracteres |
| `clientSecret` | text, nullable | cifrado con `encryptValue` (`enc:v1:`); nunca sale por la API (FR-015) |
| `accessGroup` | text, nullable | uno o varios grupos separados por comas; vacío = no se crean cuentas (FR-007a) |
| `adminGroup` | text, nullable | vacío = no se sincronizan roles (R7) |
| `groupsClaim` | text | default `groups`; claim con grupos o roles (lista, texto u objeto con los roles como claves) (FR-023) |
| `extraScopes` | text | default vacío; scopes separados por espacios, sintaxis RFC 6749 §3.3 (FR-023a) |
| `buttonLabel` | text | default `Sign in with SSO`; 1–64 caracteres (FR-003) |
| `allowInsecureHttp` | boolean | default `false` |
| `verifiedIssuer` | text, nullable | issuer con el que el owner completó un login de prueba (FR-011) |
| `verifiedAt` | timestamp, nullable | cuándo |
| `createdAt` / `updatedAt` | timestamp | |

### Configuración efectiva (valor en memoria, no persistido)

`EffectiveConfig = merge(dbRow, envOverrides)`. Cada campo lleva su origen `source: "env" | "db"`.
Las variables de entorno prevalecen (FR-019) y la interfaz muestra los campos con `source = "env"`
como bloqueados (FR-020).

`active` (booleano calculado) vale `true` solo si se cumplen todas estas condiciones:
- `mode !== "disabled"`;
- `issuerUrl`, `clientId` y `clientSecret` están presentes;
- la instancia no es cloud;
- no hay licencia enterprise activa (R14).

Si `active = false`, todo se comporta como `disabled`.

### Transiciones de `mode`

```
disabled ──► button ──► sso-only
    ▲           ▲           │
    └───────────┴───────────┘   (cualquier transición hacia abajo está siempre permitida)
```

- Pasar a `button` exige `issuerUrl`, `clientId` y `clientSecret`.
- Pasar a `sso-only` exige, además, `verifiedIssuer === issuerUrl` **y** que el owner tenga
  un vínculo con el proveedor (FR-011).
- El comando de emergencia fuerza `sso-only → button` (FR-012a).
- Cambiar `issuerUrl` invalida `verifiedIssuer`. Si el modo era `sso-only`, la actualización
  se rechaza: primero hay que bajar a `button`.

## Tabla nueva `oidc_sso_auth_event`

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | text PK | nanoid |
| `createdAt` | timestamp | índice |
| `type` | text | `sso_login` \| `emergency_login` \| `config_change` \| `mode_change` |
| `outcome` | text | `success` \| `denied` \| `error` |
| `reason` | text, nullable | código estable (ver contratos, códigos de error) |
| `email` | text, nullable | |
| `userId` | text, nullable | sin FK: el evento sobrevive al usuario |
| `ip` | text, nullable | |
| `correlationId` | text | el que se muestra al usuario (NFR-QA-004) |

Retención: 90 días (R12).

## Entidades reutilizadas

- **`account`** (vínculo de identidad, R8): `providerId = "oidc"`, `accountId = sub`,
  `idToken` = último ID token (solo para el logout). `accessToken` y `refreshToken` quedan en
  `null` (NFR-SEC-007).
- **`member`**: rol `admin` o `member` en la organización del owner, recalculado en cada
  login cuando hay grupo de administración (FR-008a). La fila con `role = "owner"` nunca se
  modifica (FR-008b).
- **`user`**:
  - al crearse por SSO: `emailVerified = true`, `firstName`/`lastName` desde
    `given_name`/`family_name`, `isRegistered = true`;
  - si tiene `banned = true`, se le deniega el acceso.
- **`session`**: se crea con `internalAdapter.createSession`. Los hooks de upstream fijan la
  organización activa.

## Objeto de decisión (dominio puro)

```
AccessInput  = { claims: { sub, email?, emailVerified, groups[] , givenName?, familyName? },
                 existingUser?: { id, banned, isOwner, currentRole },
                 config: { accessGroup?, adminGroup? } }
AccessResult = { allow: true,  action: "link" | "create" | "login", role: Role | "unchanged" }
             | { allow: false, reason: DenyReason }
DenyReason   = "email_missing" | "email_unverified" | "not_in_access_group"
             | "provisioning_disabled" | "user_banned" | "no_owner"
```
