# Data Model: Solo lectura por entorno para qa y para ver producción

Todo es aditivo (principio II). Hay columnas nuevas en dos tablas del módulo, en una sola migración de
Drizzle detrás de `0198_spicy_blackheart` (la de la 005). Las tablas de upstream no cambian.

## `oidc_sso_member_profile` (tabla del módulo) · columnas nuevas

| Columna | Tipo | Nulo | Por defecto | Uso |
|---|---|---|---|---|
| `read_only_environment_ids` | `text[]` | no | `'{}'` | entornos de solo lectura del member tras la unión de R2 |
| `read_only_service_ids` | `text[]` | no | `'{}'` | servicios de esos entornos en el momento del login |
| `read_only_project_ids` | `text[]` | no | `'{}'` | proyectos que contienen alguno de esos entornos |

**Transiciones** (las de la 005, ampliadas):
- **Al aplicar (login con perfil):** se escriben las tres listas junto con el alcance. Si el perfil no marca nada de solo lectura, quedan vacías.
- **Al caducar:** se vacían las tres, junto con los permisos y el alcance de `member`.
- **Al revocar:** la fila se borra, como en la 005.

Las filas de la 005 reciben `'{}'` por el valor por defecto. Sin solo lectura configurada, nada
cambia (FR-012).

## `oidc_sso_auth_event` (tabla del módulo) · columna nueva

| Columna | Tipo | Nulo | Uso |
|---|---|---|---|
| `resource_id` | `text` | sí | id del servicio, entorno o proyecto afectado por una denegación de solo lectura (R9). Sin clave foránea, como `user_id`: el evento sobrevive al recurso |

## `member` (tabla de upstream) · sin cambios

- **Alcance:** los entornos de solo lectura y sus servicios siguen entrando en `accessedEnvironments` y `accessedServices`, y sus proyectos en `accessedProjects` (R2). Así upstream deja verlos.
- **Permisos:** se escriben igual que en la 005.

## Perfil de grupo (valor) · campo nuevo

```text
GroupProfile {
  group, permissions, projects, environments?      // spec 005
  readOnly?: true | string[]                        // nuevo; 1..20 nombres, 1..256 caracteres
}
```

**Validación (FR-014), además de la de la 005:**
- `readOnly` es `true`, `false` o una lista no vacía de nombres únicos.
- Con `environments.include`, cada nombre de `readOnly` está en `include`.
- Con `environments.exclude`, ningún nombre de `readOnly` está en `exclude`.

Si algo falla, se rechaza el conjunto entero.

## Alcance resuelto (valor) · ampliado

```text
ResolvedScope {
  projectIds, environmentIds, serviceIds             // spec 005 (incluyen los de solo lectura)
  readOnly: ReadOnlyScope
}

ReadOnlyScope {
  environmentIds: string[]
  serviceIds: string[]
  projectIds: string[]
}
```

- **Cálculo:** `readOnly.environmentIds` = ⋃ entornos de solo lectura por grupo − ⋃ entornos completos por grupo (FR-007).
- **`ScopeCatalog`:** no cambia. Ya devuelve el nombre y el proyecto de cada entorno.

## Caché `readOnlyScopeCache` (memoria del proceso)

| Clave | Valor | Escritura | Recarga |
|---|---|---|---|
| `userId` | `ReadOnlyScope` en conjuntos (`Set`) | `grant`, `expire` y `revoke` solo **invalidan** la entrada, para que un login que se deshace no deje en memoria un alcance que la base de datos no tiene | completa cada 5 min. Además, carga una fila cuando falta la entrada del usuario |

- **Consulta:** un usuario con perfil y todos los conjuntos vacíos no tiene solo lectura.
- **Error de carga:** deniega la petición (NFR-SEC-001).

## Registro `READ_ONLY_POLICY` (valor, código)

```text
Map<procedurePath | "<router>.*", Rule>

Rule =
  | { kind: "service", key }
  | { kind: "environment", key }
  | { kind: "project", key }
  | { kind: "move", key, targetKey }
  | { kind: "lookup", resource: SubResource, key }
  | { kind: "unbound" }
  | { kind: "outside" }
  | { kind: "secretQuery", key }    // queries con secretos en texto libre (R6)

SubResource = domain | mount | port | redirect | security | backup | volumeBackup
            | schedule | deployment | rollback | previewDeployment | patch
```

- **Resolución:** primero se busca el procedimiento exacto y después `<router>.*`. Si no hay ninguno, la llamada se deniega.
- **Tabla completa:** en `contracts/guard-and-redaction.md`.

## Constantes

| Nombre | Valor | Origen |
|---|---|---|
| `MAX_READ_ONLY_ENVIRONMENTS` | 20 | R1, igual que `MAX_ENVIRONMENTS` |
| `READ_ONLY_DENIED_MESSAGE` | `This environment is read-only for you.` | R4 |
| `REDACTED_VALUE` | `••••••••` | R6 |
| `TERMINAL_INSPECT_TIMEOUT_MS` | 5 000 | R7 |
