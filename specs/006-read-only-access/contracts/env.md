# Contrato: `readOnly` en `groupProfiles`

La variable sigue siendo `SSO_OIDC_GROUP_PROFILES`, con las reglas de precedencia, tamaño y errores de
la spec 005 (`specs/005-developer-access/contracts/env.md`). Esta spec solo añade una clave opcional
al perfil de cada grupo.

## Formato

```json
{
  "<grupo>": {
    "permissions": ["..."],
    "projects": ["..."],
    "environments": { "include": ["..."] },
    "readOnly": true
  }
}
```

**`readOnly`** es opcional y admite estos valores:

| Valor | Efecto |
|---|---|
| sin la clave, o `false` | acceso completo a todo el alcance, como en la 005 |
| `true` | todos los entornos del alcance del grupo son de solo lectura |
| `["<entorno>", ...]` | solo esos entornos son de solo lectura; el resto del alcance tiene acceso completo |

- **Validación de los nombres:** 1 a 20, únicos, de 1 a 256 caracteres. Deben estar dentro del alcance del grupo: en `include`, si lo hay, y nunca en `exclude`.
- **Nombre que no existe:** si coincide con el filtro pero no existe en ningún proyecto, no es un error. Aparece como aviso en `groupProfilesCheck` (`missingReadOnlyEnvironments`).

Errores nuevos (se rechaza el conjunto entero, FR-014):
- `qa.readOnly: must be true, false or a list of environment names`
- `developers.readOnly[0]: environment "production" is excluded from the group scope`
- `developers.readOnly[1]: environment "stage" is not in the group include list`
- `qa.readOnly[2]: duplicate environment "staging"`

## Varios grupos

Un entorno es de solo lectura para una persona solo si **ninguno** de sus grupos se lo da con acceso
completo (FR-007). Los permisos (`permissions`) se suman como en la 005.

## Configuración de Milpia (lab, y prod cuando esta spec esté en canary y probada en el lab)

Los nombres de proyecto y de entorno los decide el owner. Este es el caso previsto en la spec:

```dotenv
SSO_OIDC_GROUP_PROFILES={"developers":{"permissions":[],"projects":["milpia"],"readOnly":["production"]},"qa":{"permissions":[],"projects":["milpia"],"environments":{"exclude":["production"]},"readOnly":true}}
```

- **`developers`:** deja de excluir producción y la ve en solo lectura. El resto de entornos sigue con acceso completo.
- **`qa`:** ve todo `milpia` salvo producción, en solo lectura.

Infra añade `qa` a `SSO_OIDC_ACCESS_GROUP` y a `deploy_access_groups` solo después de probar esta
configuración en el lab. Nunca antes: sin `readOnly`, un perfil de `qa` daría acceso completo.
