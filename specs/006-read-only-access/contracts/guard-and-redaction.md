# Contrato: guarda de solo lectura, ocultación de secretos y WebSocket

## `readOnlyGuard` (middleware tRPC)

Se encadena en `protectedProcedure` después de `memberProfileGuard`, y por tanto también en
`withPermission`. Orden de salidas:

1. Si `ctx.user.role !== "member"`: `next()`, sin leer nada.
2. Si el usuario no está en `memberProfileCache` (005): `next()`.
3. Obtiene su `ReadOnlyScope` de `readOnlyScopeCache`, cargando su fila si falta. Si los tres conjuntos están vacíos: `next()`.
4. Según el tipo de llamada:
   - **`mutation` o `subscription`:** evalúa la regla de `READ_ONLY_POLICY` para `path` con `await getRawInput()`.
     - Si la regla **deniega:** `FORBIDDEN` con `This environment is read-only for you.` y el evento `member_profile`/`denied`/`read_only` (action = `path`, resource_id = id afectado).
     - Si la regla **permite:** `next()`.
   - **`query`:**
     - si la regla es `secretQuery` y el destino es de solo lectura: `FORBIDDEN`, igual que arriba;
     - si no, hace `const result = await next()`. Si `result.ok`, devuelve `{ ...result, data: redact(result.data, scope) }`.
5. Ante cualquier excepción propia: `FORBIDDEN` con `This environment is read-only for you.` y el evento `member_profile`/`error`/`read_only_check_failed`. Nunca deja pasar ni devuelve una respuesta sin ocultar (NFR-SEC-001).

Las pruebas de deriva comprueban que:
- `readOnlyGuard` está en la cadena de `protectedProcedure`, y va después de `memberProfileGuard`;
- toda `mutation` y `subscription` de `appRouter` tiene regla;
- toda query de la lista de texto libre tiene regla `secretQuery` o `unbound`.

## `READ_ONLY_POLICY` (reglas de las mutaciones)

Además de la regla, **cualquier** id de servicio, en cualquier nivel de la entrada (también dentro de listas, como `selectedServices` de `project.duplicate`, donde un `{ id, type }` con un tipo de servicio cuenta como id de servicio), (`applicationId`, `composeId`, `<db>Id`, `serviceId`, `databaseId`) o de entorno (`environmentId`, `targetEnvironmentId`, `sourceEnvironmentId`) de la entrada que esté en el alcance de solo lectura deniega. Así se cubren los `move` hacia producción y las actualizaciones que redirigen un subrecurso a un servicio de solo lectura. La entrada puede ser un objeto o un `FormData` (`application.dropDeployment`).

Las claves de entrada son las de upstream en `canary` `3d9bfd345`. `<db>` es `postgres`, `mysql`,
`mariadb`, `mongo`, `redis` y `libsql`.

| Procedimientos | Regla |
|---|---|
| `application.*` (salvo las de abajo) | `service(applicationId)` |
| `application.create`, `application.deployNginxQuickstart` | `environment(environmentId)` |
| `application.move` | `move(applicationId, targetEnvironmentId)` |
| `compose.*` (salvo las de abajo) | `service(composeId)` |
| `compose.create`, `compose.deployTemplate`, `compose.import` | `environment(environmentId)` |
| `compose.move` | `move(composeId, targetEnvironmentId)` |
| `compose.previewTemplate` | `outside` (no escribe nada) |
| `<db>.*` (salvo las de abajo) | `service(<db>Id)` |
| `<db>.create` | `environment(environmentId)` |
| `<db>.move` | `move(<db>Id, targetEnvironmentId)` |
| `environment.create` | `outside`: un entorno nuevo no es de solo lectura hasta el siguiente login, y si el perfil lo marca por nombre lo será entonces |
| `environment.update`, `environment.remove`, `environment.duplicate` | `environment(environmentId)` |
| `project.update`, `project.remove` | `project(projectId)` |
| `project.duplicate` | `environment(sourceEnvironmentId)`: copia el entorno de origen con sus variables |
| `project.create`, `project.completeOnboarding` | `outside` |
| `domain.create` | `service(applicationId ‖ composeId)`; el tipo `preview` es `unbound` |
| `domain.update`, `domain.toggleEnable`, `domain.delete` | `lookup(domain, domainId)` |
| `domain.generateDomain`, `domain.validateDomain` | `outside` (no cambian ningún servicio) |
| `mounts.create` | `service(serviceId)` |
| `mounts.update`, `mounts.remove` | `lookup(mount, mountId)` |
| `port.create`, `redirects.create`, `security.create` | `service(applicationId)` |
| `port.*`, `redirects.*`, `security.*` (update, delete) | `lookup(port‖redirect‖security, <x>Id)` |
| `backup.create` | `service(` primer id presente de `postgresId`, `mysqlId`, `mariadbId`, `mongoId`, `libsqlId`, `composeId` `)`; sin ninguno, deniega |
| `backup.update`, `backup.remove`, `backup.manualBackup*` | `lookup(backup, backupId)` |
| `backup.manualBackupWebServer` | `unbound` |
| `backup.restoreBackupWithLogs` | `service(databaseId)`; sin él, deniega |
| `volumeBackups.create` | `service(` primer id de servicio presente `)`; sin ninguno, deniega |
| `volumeBackups.update`, `.delete`, `.runManually` | `lookup(volumeBackup, volumeBackupId)` |
| `volumeBackups.restoreVolumeBackupWithLogs` | `unbound`: restaura en un volumen nombrado en la entrada, que puede ser de cualquier entorno |
| `schedule.create` | `service(applicationId ‖ composeId)`; si es de servidor, `unbound` |
| `schedule.update`, `.delete`, `.runManually` | `lookup(schedule, scheduleId)` |
| `deployment.killProcess`, `deployment.removeDeployment` | `lookup(deployment, deploymentId)` |
| `rollback.*` | `lookup(rollback, rollbackId)` |
| `previewDeployment.*` | `lookup(previewDeployment, previewDeploymentId)` |
| `patch.create` | `service(applicationId ‖ composeId)` |
| `patch.update`, `.delete`, `.toggleEnabled` | `lookup(patch, patchId)` |
| `patch.ensureRepo`, `.saveFileAsPatch`, `.markFileForDeletion` | `service(id)` |
| `docker.*`, `dockerVolume.*`, `dockerImage.*`, `dockerDiskUsage.*`, `network.*`, `cluster.*`, `server.*`, `settings.*`, `certificates.*` | `unbound` (actúan sobre el servidor, no sobre un entorno) |
| `registry.*`, `destination.*`, `dnsProvider.*`, `vaultProvider.*`, `sshKey.*`, `gitProvider.*`, `github.*`, `gitlab.*`, `gitea.*`, `bitbucket.*` | `unbound`: son recursos compartidos por todos los entornos; cambiarlos llega también a los de solo lectura |
| `ai.*` | `outside`, salvo `ai.deploy`: `environment(environmentId)` |
| `tag.*` | `outside` (etiquetas del proyecto, no cambian servicios) |
| `user.*`, `notification.*`, `oidcSso.*`, `organization.*`, `stripe.*`, `admin.*` | `outside` (no están ligados a un entorno, o upstream ya los reserva a admin) |
| `sso.*`, `scim.*`, `licenseKey.*`, `whitelabeling.*`, `customRole.*`, `auditLog.*` | `outside`: son routers enterprise que viven bajo `/proprietary`. Solo se clasifica su nombre, sin leer su código (principio I) |
| `forwardAuth.enable`, `forwardAuth.disable` | `lookup(domain, domainId)`; el resto de `forwardAuth.*` es `unbound` (actúa sobre el servidor) |

La tabla definitiva vive en el código (`read-only/policy.ts`). La prueba de deriva la contrasta con
`appRouter`. Esta tabla es la intención de diseño: si al implementar aparece un procedimiento que no
encaja, se añade con su regla y la prueba lo exige.

## Queries con secretos en texto libre (`secretQuery`)

| Procedimiento | Regla |
|---|---|
| `compose.getConvertedCompose`, `compose.loadMountsByService` | `secretQuery(composeId)` |
| `application.readTraefikConfig` | `secretQuery(applicationId)` |
| `docker.getConfig`, `docker.readContainerFile`, `dockerVolume.readVolumeFile` | `unbound` |

## `redact(data, scope)` y `SECRET_FIELDS`

Recorre objetos y arrays en profundidad. Decide por objeto (R6):
- **Por entorno:** `environmentId ∈ scope.environmentIds`.
- **Por servicio:** un id de servicio (`applicationId`, `composeId`, `postgresId`, `mysqlId`, `mariadbId`, `mongoId`, `redisId`, `libsqlId`) en `scope.serviceIds`.
- **Por proyecto:** una fila con `projectId` y `env` pero sin `environmentId`, con `projectId ∈ scope.projectIds`.
- **Por herencia:** si el objeto no tiene claves identificadoras, usa la decisión de su padre.

| Campo | Tratamiento |
|---|---|
| `env`, `previewEnv`, `buildArgs`, `previewBuildArgs`, `buildSecrets`, `previewBuildSecrets` | se interpretan con `dotenv`, como en el despliegue, y se devuelve solo `NOMBRE=••••••••` por cada variable. Así un valor multilínea (una clave PEM, un JSON) no deja ninguna línea visible |
| `databasePassword`, `databaseRootPassword`, `password`, `refreshToken`, `content` (mounts de tipo archivo), `composeFile`, `command` | `••••••••`, si el valor no es nulo |

La lista exacta de columnas secretas y no secretas vive en `read-only/secret-fields.ts`. La prueba de
deriva de columnas de R6 obliga a clasificar cualquier columna nueva cuyo nombre parezca secreto.

## `oidcSso.memberProfileStatus` · campo nuevo

```ts
output: {
  ...lo de la 005,
  readOnly: { environmentIds: string[]; serviceIds: string[]; projectIds: string[] }
}
```

Sale de `readOnlyScopeCache`, sin consultas nuevas. Lo usa `ReadOnlyBoundary` (R10).

## `oidcSso.groupProfilesCheck` · campo nuevo

```ts
groups: Array<{ ...lo de la 005, missingReadOnlyEnvironments: string[] }>
```

## WebSocket

Las comprobaciones nuevas solo se aplican a members con perfil de grupo. El resto sale sin coste
(FR-009).

| Ruta | Comprobación nueva | Resultado si deniega |
|---|---|---|
| `/docker-container-terminal` | `checkContainerBinding({ userId, orgId, serviceId, containerId, serverId })` después de `canAccessDockerOverWss`. Deniega si falta `serviceId` o si el contenedor no pertenece al servicio (FR-004b). Con solo lectura, deniega además si el servicio es de solo lectura (FR-004) | cierra la conexión con `4003` y registra `member_profile`/`denied` con action `wss:docker-container-terminal` y reason `read_only` o `container_mismatch` |
| `/docker-container-logs` | `checkContainerBinding`, igual que la terminal, sin la regla de solo lectura (FR-004b) | igual, con action `wss:docker-container-logs` y reason `container_mismatch` |
| `/listen-deployment` | `checkDeploymentLogAccess({ userId, orgId, logPath })`: caducidad de la 005, y el despliegue resuelto a un servicio de `accessedServices` (FR-004c) | igual, con action `wss:listen-deployment` y reason `out_of_scope` o `profile_expired` |
| `/terminal` | caducidad de la 005 y, con solo lectura, rechazo (FR-004a) | igual, con action `wss:terminal` y reason `read_only` |
| `/listen-docker-stats-monitoring` | ninguna: es lectura y upstream la autoriza por servicio | — |
