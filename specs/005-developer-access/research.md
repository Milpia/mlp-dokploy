# Research: Los developers entran por SSO con su perfil y solo a sus proyectos

Decisiones de la fase 0, cada una en formato Decision / Rationale / Alternatives. El código se leyó
en `canary` `7b0bd5200`, sin abrir nada bajo `/proprietary`.

## R1. Dónde se aplica el perfil en el login

**Decision**: un paso nuevo, `applyGroupProfile`, dentro de la transacción de `provisionIdentity`
(`packages/server/src/oidc-sso/identity/provisioning.ts:102`), justo después de `ensureMembership` y
`recordLoginState`. Se ejecuta con la decisión de acceso ya calculada, así que conoce el rol final.

**Rationale**:
- Es el único punto por el que pasa todo login por SSO.
- Ya salta al owner (`if (!isOwner)`).
- Si falla, la transacción entera se deshace y el login termina en `sso_unavailable`: nadie queda
  con permisos a medias (NFR-SEC-001).

**Alternatives**:
- Un hook `after` de better-auth: se ejecuta fuera de la transacción del alta.
- Aplicarlo en cada petición: añadiría consultas a todas las peticiones (NFR-PERF-002).

## R2. Cómo se escriben los permisos y el alcance

**Decision**: se escriben en las columnas de upstream de la tabla `member`: los 11 booleanos
`canCreateProjects` … `canAccessToTraefikFiles` y las listas `accessedProjects`,
`accessedEnvironments` y `accessedServices`. En cada login con perfil se sobrescriben enteras, con los
booleanos que el perfil no otorga a `false` (FR-003).

**Rationale**:
- Upstream ya lee de ahí en todas partes, a través de `findMemberByUserId`
  (`packages/server/src/services/permission.ts:415`), `getLegacyOverrides` (:141) y
  `checkProjectAccess`, `checkEnvironmentAccess` y `checkServiceAccess` (:218-293), además de los
  filtros de `routers/project.ts` y `routers/environment.ts`.
- No hay que tocar ninguna comprobación de upstream: el perfil cumple FR-010 en todas las vías.

**Alternatives**: interceptar `findMemberByUserId` para devolver permisos calculados. Cambia un
archivo de upstream muy usado y no cubre los filtros hechos a mano en los routers.

## R3. Origen de los permisos y revocación

**Decision**: una tabla nueva, `oidc_sso_member_profile` (data-model.md), con una fila por usuario
cuyos permisos vienen de sus grupos. Regla del login para un usuario con rol `member`:

| Pertenece a un grupo con perfil | Tiene fila | Acción |
|---|---|---|
| sí | — | sobrescribe permisos y alcance, y crea o actualiza la fila |
| no | sí | pone los 11 permisos a `false`, vacía las tres listas y borra la fila (FR-004) |
| no | no | nada (FR-005) |

Si el rol final es admin (o owner) y hay fila, se vacían los permisos y las listas y se borra la fila.
Así no quedan permisos viejos si más adelante vuelve a ser member.

**Rationale**:
- La fila es la «constancia de origen» de la spec.
- Distingue a quién hay que quitarle permisos de quién los tiene puestos a mano.
- Alimenta el aviso de la lista de usuarios (FR-011).

**Alternatives**: marcar el origen con una columna en `member`. Altera una tabla de upstream y el
principio II solo lo admite si es imprescindible.

## R4. Configuración: formato, dónde vive y validación

**Decision**:
- **Formato**: un único ajuste JSON, `groupProfiles`, en `oidc_sso_config` (columna nueva `group_profiles text`) y en la variable `SSO_OIDC_GROUP_PROFILES`, con la precedencia de siempre (el entorno manda y aparece bloqueado; `config/provider.ts:37`, `admin/config-admin.ts:179`). Estructura en `contracts/env.md`.
- **Permisos**: se escriben con el nombre de la columna de upstream (`canCreateServices`, …). Cualquier otro nombre se rechaza (FR-009).
- **Validación**: con zod, en un módulo puro (`domain/group-profiles.ts`), que usan igual el guardado de la pantalla y la lectura del entorno.
- **Si el entorno no es válido**: se ignora entero, se registra en los errores del entorno que ya se muestran en la pantalla de SSO (`config/env.ts`) y los perfiles quedan desactivados.

**Rationale**:
- Un solo ajuste mantiene juntos permisos y alcance de cada grupo.
- Con el nombre exacto de la columna no hay tabla de traducción que se pueda desalinear con upstream.

**Alternatives**:
- Dos variables, una para perfiles y otra para alcances: separa lo que se lee junto.
- Una tabla por grupo con su propio formulario: mucha más interfaz para una configuración que Milpia pondrá por entorno.

## R5. Resolver nombres de proyectos y entornos a ids

**Decision**: en cada login con perfil se resuelven los nombres dentro de la organización del owner.
1. Proyectos cuyo `name` está en la lista. Los nombres no son únicos en upstream (`schema/project.ts`): si coinciden varios, se incluyen todos.
2. Sus entornos, filtrados por `environments.include` o `environments.exclude` si están definidos (por `name`; el entorno por defecto se llama `production`, `services/environment.ts:392`).
3. Los ids de servicio de esos entornos en las 8 tablas de servicio: `application`, `compose`, `postgres`, `mysql`, `mariadb`, `mongo`, `redis` y `libsql`.

Los nombres que no coinciden con nada se ignoran (spec, casos límite). Una query de solo lectura para el owner, `oidcSso.groupProfilesCheck`, lista los nombres que no se encuentran y los que coinciden con más de un proyecto.

**Rationale**:
- La spec pide nombres (clarify P1).
- Resolverlos en el login recoge proyectos, entornos y servicios nuevos sin tareas programadas.
- Son unas 10 consultas indexadas por `projectId`/`environmentId` (NFR-PERF-001: ≤ 50 ms).

**Alternatives**: guardar ids en la configuración. No resiste que un proyecto se recree, y la spec pide nombres.

## R6. Caducidad a las 8 horas (FR-017)

**Decision**:
- **Revocación perezosa.** Un middleware tRPC, `memberProfileGuard`, se encadena en `protectedProcedure` junto a `userManagementGuard` (`apps/dokploy/server/api/trpc.ts:176`); `withPermission` deriva de él (:269).
- **Cuándo actúa.** Solo para `ctx.user.role === "member"`, y solo si el usuario está en una caché en memoria de «usuarios con fila en `oidc_sso_member_profile`». Si su último login por SSO (`oidc_sso_login_state.last_sso_login_at`) tiene 8 horas o más:
  1. en una transacción, pone los permisos a `false`, vacía las listas y marca la fila como caducada (`expired_at`);
  2. registra un evento `member_profile`/`denied`/`profile_expired`, que también sale en el log del contenedor (T062);
  3. deja seguir la petición, que ya se evalúa sin permisos.
- **Constante.** Se reutiliza `USER_MANAGEMENT_GRANT_TTL_MS` (`domain/user-management.ts:5`) con un nombre común.
- **La caché.** Se carga al arrancar y se actualiza en cada escritura de la tabla. Dokploy corre en un solo proceso.
- **Coste.**
  - Owner y admins: nada.
  - Members sin fila: una búsqueda en un `Set` en memoria.
  - Members con fila: una consulta indexada por `user_id`.

  Cumple NFR-PERF-002.

**Rationale**:
- Las comprobaciones de upstream siguen leyendo de `member` sin cambios.
- La revocación es real en la base de datos: también vale para las claves de API y para cualquier vía que lea `member`.

**Alternatives**:
- Comprobar la caducidad dentro de `checkPermission` de upstream: toca un archivo central y no cubre los filtros de los routers.
- Una tarea programada que revoque cada hora: el plazo real pasaría a ser de hasta 9 h.

**Límite conocido**: las conexiones WebSocket ya abiertas (logs en vivo, terminal) no pasan por tRPC. Siguen hasta que se cierran, y la siguiente petición del panel ya aplica la revocación. El panel hace peticiones tRPC continuamente, así que el margen es de segundos.

## R7. Aviso en el panel

**Decision**:
- **`oidcSso.memberProfileStatus`** (`protectedProcedure`): devuelve para el usuario actual `{ managed, groups, expiresAt, expired }`. Una página de upstream (`pages/dashboard/projects.tsx`) muestra, si `expired`, un `AlertBlock` con `SignInWithSso`, el mismo componente que usa la spec 002 en `pages/dashboard/settings/users.tsx`.
- **`oidcSso.memberProfiles`** (owner y admin): devuelve el mapa `userId → { groups, appliedAt, expired }`. Lo usan:
  - `show-users.tsx`: una insignia «SSO: <grupos>» junto al rol;
  - `add-permissions.tsx`: un aviso bajo el título de que un cambio se perderá en el siguiente login por SSO (FR-011).

**Rationale**:
- Las queries de upstream (`user.all`, `user.one`) no se tocan.
- Los componentes nuevos viven en el módulo y los archivos de upstream solo los montan.

**Alternatives**: añadir el origen a `user.all`. Cambia la respuesta de una query de upstream.

## R8. Varios grupos, roles y enterprise

**Decision**:
- **Varios grupos con perfil:** unión de permisos (OR) y de proyectos. Para los entornos, se unen los resultados por proyecto (FR-006).
- **Rol final admin u owner:** no se aplica perfil (FR-007, R3).
- **Rol personalizado** (distinto de owner, admin o member): no se aplica ni se revoca (FR-014).
- **Licencia enterprise:** el SSO queda inactivo (regla de la spec 002, R4), así que el perfil tampoco se aplica.

## R9. Eventos

**Decision**:
- **Cambios de `groupProfiles` desde la pantalla:** evento `config_change` como el resto de ajustes, con el campo en la lista de campos cambiados (FR-012).
- **Error al aplicar el perfil durante el login:** evento `sso_login`/`error` con `reason=profile_failed` y su referencia (NFR-SEC-001).
- **Caducidad:** evento `member_profile`/`denied`/`profile_expired` (R6).
- **Aplicación correcta:** no genera evento. Ya queda el `sso_login` correcto, y otro evento solo sería ruido.

## R10. Límites de la configuración

**Decision**: como máximo 20 grupos, 200 proyectos por grupo y 20 entornos por lista. Nombres de grupo de hasta 256 caracteres (igual que `normalizeLoginGroups`) y JSON de hasta 16 KB. Fuera de esos límites se rechaza con un mensaje (FR-009).

**Rationale**: acota el coste del login (NFR-PERF-001) y el tamaño de la fila de configuración.

## R11. Seguridad (ASVS 4.0, V4 Access Control)

- **V4.1.1** (el control se aplica en el servidor): los permisos se escriben en `member` y los aplica upstream en el servidor. La pantalla solo informa.
- **V4.1.3** (mínimo privilegio): un perfil sin permisos da solo el alcance. La configuración de Milpia para `developers` no otorga ninguno de los 11 permisos.
- **V4.1.5** (fallo cerrado): un error al calcular el perfil deshace el login. Un error en el middleware de caducidad deniega la petición con `FORBIDDEN` y registra el evento.
- **V4.2.1** (IDOR): el alcance se resuelve en el servidor con ids de la base de datos; el member no puede enviar el suyo (NFR-SEC-002).
- **Cambios de configuración:** solo el owner (`ownerProcedure`), y quedan registrados (FR-012).
- **Revisión:** se ejecutará `/security-review` antes del PR.
