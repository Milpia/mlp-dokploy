# Data Model: Los developers entran por SSO con su perfil y solo a sus proyectos

Todo es aditivo (principio II): una columna nueva en una tabla del módulo y una tabla nueva, en una
sola migración de Drizzle detrás de `0197_equal_wallflower`. Las tablas de upstream no cambian.

## `oidc_sso_config` (tabla del módulo) · columna nueva

| Columna | Tipo | Nulo | Por defecto | Uso |
|---|---|---|---|---|
| `group_profiles` | `text` | sí | `null` | JSON de perfiles y alcances por grupo (contracts/env.md). `null` o vacío = desactivado (FR-013) |

- **Campo de configuración:** `groupProfiles`. Se añade a `ConfigField`, `EnvOverrideValues`, `StoredConfig` y al mapeo del repositorio, igual que `userManagementGroup` en la spec 002.
- **Si viene de `SSO_OIDC_GROUP_PROFILES`:** manda y aparece bloqueado.

## `oidc_sso_member_profile` (tabla nueva)

Constancia de que los permisos y el alcance de un member vienen de sus grupos (R3).

| Columna | Tipo | Nulo | Uso |
|---|---|---|---|
| `user_id` | `text` PK, FK → `user.id` `on delete cascade` | no | usuario |
| `organization_id` | `text`, FK → `organization.id` `on delete cascade` | no | organización del member |
| `groups` | `text[]` | no | grupos con perfil que se le aplicaron en el último login |
| `applied_at` | `timestamp` | no | momento del último login por SSO que aplicó el perfil |
| `expired_at` | `timestamp` | sí | momento en que caducó por las 8 h (R6); `null` mientras está vigente |
| `updated_at` | `timestamp` | no | última escritura |

**Transiciones** (una fila por usuario):

```text
(sin fila) ──login con perfil──▶ vigente ──8 h sin login por SSO──▶ caducada
    ▲                              │  ▲                               │
    │                              │  └──────login con perfil─────────┘
    └──login sin grupo con perfil, o rol admin/owner (revoca y borra)─┘
```

- **Al aplicar:** se escriben los permisos y el alcance en `member`, con `groups` y `applied_at` actualizados y `expired_at = null`.
- **Al caducar:** los 11 permisos quedan en `false` y las listas vacías. La fila se conserva con `expired_at`, para mostrar el aviso de volver a entrar.
- **Al revocar:** los permisos quedan en `false`, las listas vacías y la fila se borra.

## `member` (tabla de upstream) · se escribe, no cambia

Columnas que el perfil sobrescribe (FR-003) o vacía (FR-004 y FR-017):
- **Los 11 permisos:** `canCreateProjects`, `canDeleteProjects`, `canCreateServices`, `canDeleteServices`, `canCreateEnvironments`, `canDeleteEnvironments`, `canAccessToDocker`, `canAccessToAPI`, `canAccessToSSHKeys`, `canAccessToGitProviders`, `canAccessToTraefikFiles`.
- **Las listas de alcance:** `accessedProjects` (columna `accesedProjects`), `accessedEnvironments` y `accessedServices` (columna `accesedServices`).

No se tocan `accessedGitProviders`, `accessedServers` ni el rol, que sigue siendo cosa de la spec 001.

## Perfil de grupo (valor, no tabla)

Resultado de validar `groupProfiles` (`domain/group-profiles.ts`):

```text
GroupProfile {
  group: string                       // nombre del grupo en el IdP, 1..256
  permissions: MemberPermission[]     // subconjunto de los 11 nombres de columna; [] = ninguno
  projects: string[]                  // nombres de proyecto, 0..200
  environments?: { include: string[] } | { exclude: string[] }   // 1..20 nombres
}
```

**Validación (FR-009):**
- grupos únicos y no vacíos;
- permisos conocidos;
- `include` y `exclude` excluyentes entre sí;
- los límites de R10.

Si algo falla, el conjunto entero se rechaza.

## Alcance resuelto (valor)

`resolveScope(profiles[], orgId)` → `{ projectIds, environmentIds, serviceIds }`. Es la unión de los
grupos del usuario (R5, R8). Es puro salvo por la lectura de proyectos, entornos y servicios, que
entra por un puerto (`ScopeCatalog`) para poder probarlo sin base de datos.

## Constantes

| Nombre | Valor | Origen |
|---|---|---|
| `SSO_GRANT_TTL_MS` | 8 h | se renombra y comparte `USER_MANAGEMENT_GRANT_TTL_MS` (spec 002) |
| `GROUP_PROFILES_MAX_BYTES` | 16 384 | R10 |
| `MEMBER_PERMISSIONS` | los 11 nombres de columna | R4 |
