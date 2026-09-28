# Contrato: variable de entorno y formato de `groupProfiles`

| Variable | Formato | Efecto |
|---|---|---|
| `SSO_OIDC_GROUP_PROFILES` | JSON (abajo), ≤ 16 KB | Perfiles y alcances por grupo del IdP. Sin definir (y sin valor guardado), no cambia nada (FR-013) |

Si está definida:
- **Manda sobre el valor guardado** y aparece bloqueada en la pantalla de SSO.
- **Un valor vacío o solo espacios** cuenta como no definida, igual que el resto de `SSO_OIDC_*`.
- **Un JSON inválido** o que no pasa la validación:
  - se ignora entero;
  - se muestra en los errores de configuración de la pantalla de SSO;
  - se escribe en el log del contenedor al arrancar;
  - los perfiles quedan desactivados (FR-009).

## Formato

```json
{
  "<grupo>": {
    "permissions": ["<columna de member>", "..."],
    "projects": ["<nombre de proyecto>", "..."],
    "environments": { "exclude": ["<nombre de entorno>"] }
  }
}
```

- **`permissions`** (obligatorio, puede estar vacío): cualquiera de `canCreateProjects`, `canDeleteProjects`, `canCreateServices`, `canDeleteServices`, `canCreateEnvironments`, `canDeleteEnvironments`, `canAccessToDocker`, `canAccessToAPI`, `canAccessToSSHKeys`, `canAccessToGitProviders` o `canAccessToTraefikFiles`. Los que no aparecen se ponen a `false`.
- **`projects`** (obligatorio, puede estar vacío): nombres de proyecto. Si varios proyectos se llaman igual, entran todos.
- **`environments`** (opcional): `{ "include": [...] }` o `{ "exclude": [...] }`, nunca los dos. Sin él entran todos los entornos de los proyectos.
- **Límites:** 20 grupos, 200 proyectos por grupo y 20 entornos por lista. Nombres de grupo de 1 a 256 caracteres.

## Configuración de Milpia (lab y prod, cuando la 005 esté en canary)

Los nombres de proyecto son un ejemplo. La lista real la decide el owner.

```dotenv
SSO_OIDC_GROUP_PROFILES={"developers":{"permissions":[],"projects":["milpia-web","milpia-api"],"environments":{"exclude":["production"]}}}
```

Infra añade además `developers` a `SSO_OIDC_ACCESS_GROUP` y a `deploy_access_groups`, en el mismo PR
o después, nunca antes.
