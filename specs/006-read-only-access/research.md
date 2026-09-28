# Research: Solo lectura por entorno para qa y para ver producción

Decisiones de la fase 0, cada una en formato Decision / Rationale / Alternatives. El código se leyó
en `canary` + rama `006-read-only-access` (`3d9bfd345`), sin abrir nada bajo `/proprietary`.

## R1. Cómo se escribe la solo lectura en `groupProfiles`

**Decision**: una clave opcional nueva, `readOnly`, en el perfil de cada grupo:
- `"readOnly": true`: todos los entornos del alcance del grupo son de solo lectura.
- `"readOnly": ["production", ...]`: solo esos entornos, por nombre (1 a 20 nombres).
- Sin la clave (o `false`): acceso completo, como en la 005 (FR-012).

La validación (FR-014) se añade al parser de `domain/group-profiles.ts` y rechaza el conjunto entero si:
- el valor no es `true`, `false` ni una lista de nombres válidos;
- un nombre de la lista queda fuera del alcance del grupo: no está en `environments.include`, o está en `environments.exclude`.

El error sigue el formato de la 005, por ejemplo `qa.readOnly[0]: environment "production" is excluded from the group scope`.

**Rationale**:
- Mantiene un solo JSON (`SSO_OIDC_GROUP_PROFILES`) y una sola validación.
- `true` cubre a `qa` sin repetir nombres, y la lista cubre a `developers`.
- Comprobar la lista contra el filtro del grupo detecta erratas en la validación, sin tocar la base de datos. Un nombre que no existe en ningún proyecto no se puede comprobar ahí: sale en `groupProfilesCheck`, igual que los proyectos que no coinciden (R8).

**Alternatives**:
- Un objeto por entorno (`{"production": "read"}`): más verboso y no aporta nada con solo dos niveles.
- Grupos «hermanos» (`qa-readonly`): obliga a crear grupos por nivel, contra el principio VII.

## R2. Unión de grupos y cálculo en el login

**Decision**: `resolveScope` devuelve también el alcance de solo lectura. Por cada grupo del usuario se
calculan sus entornos completos y sus entornos de solo lectura. Después:

```text
readOnlyEnvironmentIds = ⋃ solo lectura de cada grupo − ⋃ completos de cada grupo    (FR-007)
readOnlyServiceIds     = servicios de readOnlyEnvironmentIds
readOnlyProjectIds     = proyectos que contienen algún readOnlyEnvironmentId
```

Los entornos de solo lectura siguen entrando en `accessedEnvironments` y sus servicios en
`accessedServices`. Upstream deja ver y la guarda de R4 impide cambiar.

**Rationale**:
- «Gana el acceso completo» (FR-007) es una resta de conjuntos, y se prueba con una tabla de verdad pura.
- Upstream necesita el alcance para dejar ver (FR-002). La solo lectura solo resta.

**Alternatives**: quitar los entornos de solo lectura de `accessed*` y reimplementar la lectura. Duplica
todo el control de lectura de upstream.

## R3. Dónde se guarda y cómo se consulta sin coste

**Decision**:
- **Persistencia:** tres columnas nuevas en `oidc_sso_member_profile`: `read_only_environment_ids`, `read_only_service_ids` y `read_only_project_ids`, de tipo `text[] not null default '{}'`. Se escriben en `store.grant` dentro de la transacción del login, y se vacían en `expire` y `revoke`.
- **Caché:** una caché en memoria, `readOnlyScopeCache: Map<userId, ReadOnlyScope>`, junto a `memberProfileCache` de la 005 y con la misma recarga completa cada 5 minutos:
  - `grant` la actualiza.
  - `expire` y `revoke` la dejan como está: el member ya no tiene alcance, y la entrada solo restringe.
  - Si un usuario está en `memberProfileCache` pero no en esta caché (por ejemplo, tras un reinicio), se lee su fila una vez (un fallo de caché, no una consulta por petición).

**Rationale**:
- La guarda consulta conjuntos en memoria, así que una petición de lectura no añade ninguna consulta (NFR-PERF-001).
- Guardar los ids de servicio y de proyecto permite decidir sin resolver en la base de datos en la mayoría de los casos.
- Un servicio creado después del login no está en `accessedServices`, así que el member no lo ve hasta su siguiente login, igual que en la 005, y en ese login entra ya como solo lectura.

**Alternatives**:
- **Calcularlo en cada petición:** añade consultas a todas las peticiones.
- **Guardarlo en la sesión de better-auth:** no cubre las claves de API y obliga a tocar el esquema de sesión de upstream.
- **Una columna en `member`:** altera una tabla de upstream (principio II).

## R4. Dónde se aplica en el servidor (tRPC y API con clave)

**Decision**: un middleware nuevo, `readOnlyGuard`, encadenado en `protectedProcedure` después de
`memberProfileGuard` (que antes aplica la caducidad). Sale sin hacer nada si el usuario no es member,
no tiene perfil o no tiene ningún entorno de solo lectura. Si tiene alguno:
- **Mutaciones y suscripciones:** clasifica la llamada por `path` con un registro (R5). Si el destino está en su alcance de solo lectura, deniega con `FORBIDDEN` y `This environment is read-only for you.`, y registra el evento (R9).
- **Queries:** deja pasar y oculta los secretos de la respuesta (R6).

La API pública con `x-api-key` pasa por `createOpenApiNextHandler`, que llama a los mismos
procedimientos de `appRouter` con el mismo `createTRPCContext`. El middleware la cubre sin más cambios.
Una clave de API tiene el rol y el alcance de su member (FR-005, edge case de la spec).

**Rationale**:
- `protectedProcedure` es el único punto común a la interfaz y a la API con clave.
- `userManagementGuard` (spec 002) ya clasifica por `path` y lee la entrada con `getRawInput()`, así que el patrón existe y está probado.
- Upstream no tiene una única comprobación de servicio: hay unas 230 llamadas repartidas entre `checkServicePermissionAndAccess` y `checkServiceAccess`, y algunas mutaciones no llaman a ninguna. Engancharse a esos helpers dejaría huecos y tocaría un archivo de upstream muy usado.

**Alternatives**:
- **Cambiar `checkServicePermissionAndAccess` y `checkServiceAccess`:** no cubre `restoreVolumeBackupWithLogs`, el tipo `preview` de `domain.create` ni `backup.create` sin id. Además, toca `permission.ts`.
- **Quitar permisos del rol member:** son de la organización entera, no por entorno. Hacerlo por entorno exige roles personalizados enterprise (principio I).

## R5. Registro de procedimientos: fallo cerrado y prueba de deriva

**Decision**: un registro puro, `READ_ONLY_POLICY`, que asigna a cada procedimiento `mutation` o
`subscription` de `appRouter` una de estas reglas:

| Regla | Qué hace | Ejemplos |
|---|---|---|
| `service(key)` | el id del servicio sale de `input[key]` y se busca en `readOnlyServiceIds` | `application.deploy` (`applicationId`), `postgres.saveEnvironment` (`postgresId`), `mounts.create` (`serviceId`) |
| `environment(key)` | el id del entorno sale de `input[key]` y se busca en `readOnlyEnvironmentIds` | `application.create`, `environment.update`, `environment.duplicate`, `environment.remove` |
| `project(key)` | deniega si el proyecto contiene algún entorno de solo lectura | `project.update` (sus variables llegan a producción), `project.remove`, `project.duplicate` |
| `move(key, targetKey)` | deniega si el origen o el destino son de solo lectura | `application.move`, `compose.move`, `<db>.move` |
| `lookup(kind, key)` | busca el servicio dueño del subrecurso con una consulta indexada y lo compara | `domainId`, `mountId`, `portId`, `redirectId`, `securityId`, `backupId`, `volumeBackupId`, `scheduleId`, `deploymentId`, `rollbackId`, `previewDeploymentId`, `patchId`, `id`+`serviceType` (restores de volúmenes), `databaseId` (restores) |
| `unbound` | no se puede ligar a un entorno: deniega a quien tenga algún entorno de solo lectura | `docker.*` y `docker-volume.*` (`containerId`, nombre de volumen), `backup.manualBackupWebServer`, `domain.create` de tipo `preview` |
| `outside` | no actúa sobre proyectos, entornos ni servicios | `user.*` (perfil, claves de API), `notification.*`, `oidcSso.*`, `settings.*` de usuario |

**Reglas:**
- **Sin regla en tiempo de ejecución:** una mutación o suscripción sin regla se deniega a quien tenga algún entorno de solo lectura (fallo cerrado, NFR-SEC-001).
- **Prueba de deriva:** recorre `appRouter._def.procedures` y falla si una mutación o suscripción no tiene regla. Cada merge de upstream que añada procedimientos obliga a clasificarlos antes de pasar CI.
- **Nivel de la regla:** puede definirse por router (`notification.*: outside`) y sobrescribirse por procedimiento.
- **Si la regla falla:** si falta el id en la entrada o la consulta de `lookup` no encuentra el subrecurso, se deniega.

**Rationale**:
- Denegar por defecto es la única forma de que una mutación nueva de upstream no abra un hueco (FR-005).
- Una tabla pura se prueba entera (principio IV, 100 % de las decisiones de acceso).
- `lookup` solo consulta la base de datos en mutaciones, así que las lecturas siguen sin coste (NFR-PERF-001). Es una consulta por clave primaria con join al servicio, dentro del presupuesto de 5 ms.
- Varias mutaciones de subrecursos de upstream saltan su comprobación cuando el id resuelto es nulo: `backup.create`, `mounts.update`, `mounts.remove` y `volumeBackups.create`. Con `lookup`, este caso deniega.

**Alternatives**:
- **Clasificar solo por `type`** (toda mutación sobre cualquier cosa se deniega): impediría a un developer desplegar en staging (SC-003).
- **Lista de mutaciones permitidas sin ligarlas a un entorno:** no distingue staging de producción.

## R6. Ocultar secretos en las respuestas (FR-006)

**Decision**: el mismo `readOnlyGuard`, en las queries de un member con entornos de solo lectura,
recorre la respuesta (`const result = await next()`) y oculta los campos secretos de los objetos que
pertenecen a su alcance de solo lectura:

**Qué objetos se ocultan:**
- **Por entorno:** objetos cuyo `environmentId` está en `readOnlyEnvironmentIds`.
- **Por servicio:** objetos con un id de servicio (`applicationId`, `composeId`, `postgresId`, `mysqlId`, `mariadbId`, `mongoId`, `redisId`, `libsqlId`) que está en `readOnlyServiceIds`. Esto cubre `security.one`, las mounts y los backups, que no llevan `environmentId`.
- **Filas de proyecto:** las que tienen `projectId` y `env` pero no `environmentId`, cuando el proyecto está en `readOnlyProjectIds`. Sus variables llegan a los entornos de solo lectura.
- **Hijos:** un objeto sin claves que lo identifiquen hereda la decisión de su padre. Un objeto con claves propias decide por sí mismo, así que el staging de un developer dentro de `project.one` no se oculta.

**Qué campos se ocultan** (`SECRET_FIELDS`, contrato en `contracts/guard-and-redaction.md`):
- **Variables** (`env`, `previewEnv`, `buildArgs`, `previewBuildArgs`, `buildSecrets`, `previewBuildSecrets`): se conservan los nombres y cada valor se sustituye por una máscara fija. Las líneas de comentario se quitan.
- **Resto** (`databasePassword`, `databaseRootPassword`, `password`, `refreshToken`, `content` de las mounts de tipo archivo, `composeFile` y `command`): se sustituyen por la máscara. `dockerfile` es una ruta, no un contenido, y se ve.

**Queries que devuelven secretos en texto libre:** se deniegan con la regla `service(key)` si el destino es de solo lectura, porque no se pueden ocultar por campo. Son `compose.getConvertedCompose`, `application.readTraefikConfig`, `docker.getConfig`, `docker.readContainerFile` y `docker-volume.readVolumeFile`, y las dos últimas quedan además como `unbound`.

**Prueba de deriva:**
- **Columnas:** recorre las columnas de las tablas de servicio, de `project`, de `environment`, de `mount`, de `security` y de `backup`. Falla si una columna cuyo nombre encaja con `/password|secret|token|env|key|content/i` no está en `SECRET_FIELDS` ni en una lista explícita de no secretas. Así, una columna secreta nueva de upstream no pasa sin decidir.
- **Queries en texto libre:** una prueba análoga cubre esta lista.

**Rationale**:
- **Nombres sin valores:** es lo que decidió el owner (Clarifications, Q1). Una máscara fija, y no un valor vacío, deja ver qué variables existen y que tienen valor.
- **Ocultar solo lo necesario:** decidir por objeto y no por respuesta entera permite que un developer vea los valores de su staging y no los de producción en la misma respuesta (`project.one`, `project.all`).
- **Sin coste en base de datos:** solo recorre la respuesta en memoria y solo para members con entornos de solo lectura. El bench lo mide (NFR-PERF-001).
- **`refreshToken`:** es una credencial de despliegue (`/api/deploy/[refreshToken]`). Si se viera, cualquiera podría desplegar producción sin pasar por la guarda.

**Alternatives**:
- **Un redactor por query:** hay decenas de queries que incrustan filas de servicio (`backup.one` incluye la fila entera de la base de datos). Una lista por procedimiento se desactualiza con cada merge de upstream.
- **Denegar las queries con secretos:** rompe FR-002 (ver la configuración no secreta).

**Riesgo abierto (R6-a)**: los `refreshToken` y las contraseñas que un developer ya vio antes de pasar
producción a solo lectura siguen siendo válidos. La quickstart pide al owner rotarlos al activar la
solo lectura, si lo considera necesario. La spec no pide rotarlos automáticamente.

## R7. WebSockets: contenedores, logs de despliegue y terminal del servidor

**Decision**: todas las comprobaciones de esta sección se aplican solo a members con perfil de grupo
(están en `memberProfileCache`). El owner, los admins y los members sin perfil siguen con el
comportamiento de upstream y sin coste añadido (FR-009, principio II).

- **Contenedor ligado al servicio (FR-004b):** `/docker-container-terminal` y `/docker-container-logs` llaman a una comprobación del módulo, `checkContainerBinding`, después de `canAccessDockerOverWss`:
  1. deniega si falta `serviceId`: un member con perfil solo abre contenedores desde la página de un servicio;
  2. inspecciona el contenedor (local o por SSH, con un tiempo máximo de 5 s) y compara sus etiquetas con el `appName` del servicio: `com.docker.swarm.service.name` para aplicaciones y bases de datos, y `com.docker.compose.project` o `com.docker.stack.namespace` para compose;
  3. si no coincide, no se puede inspeccionar o se agota el tiempo, deniega (FR-005).
- **Terminal en solo lectura (FR-004):** en `/docker-container-terminal`, además, se deniega si `serviceId` está en `readOnlyServiceIds`. Los logs del mismo contenedor siguen permitidos.
- **Logs de despliegue (FR-004c):** `/listen-deployment` llama a `checkDeploymentLogAccess` antes de abrir el `tail`:
  1. aplica la caducidad de la 005 (`checkMemberProfileExpiryForUser`);
  2. busca el despliegue por `logPath` y resuelve su servicio: `applicationId` o `composeId`, a través del despliegue de preview, del backup o de la tarea programada;
  3. deniega si el servicio no está en `accessedServices` del member, si el despliegue no existe o si no se puede resolver a un servicio (por ejemplo, un despliegue del servidor).
- **`/terminal` (shell del servidor, FR-004a):** se deniega a quien tenga algún entorno de solo lectura. Una shell del servidor llega a todos los entornos que corren en él. También se añade la comprobación de caducidad de la 005, que ahí faltaba.
- **Estadísticas (`/listen-docker-stats-monitoring`):** siguen permitidas. Son lectura y se autorizan por `serviceId` y `appName`, sin `containerId`.

**Rationale**:
- **Contenedor y logs de despliegue:** ligar la conexión a un servicio del alcance es lo que hace que la solo lectura y el alcance de la 005 se cumplan también fuera de tRPC. El owner decidió aplicarlo a todos los members con perfil (Clarifications), tengan o no solo lectura. El detalle del problema de seguridad está en el repositorio privado `Milpia/mlp-dokploy-security` (MIL-545, MIL-546).
- **Coste:** inspeccionar un contenedor cuesta una llamada a Docker, y resolver un despliegue, una consulta. Las dos ocurren al abrir la conexión, no en cada mensaje.

**Alternatives**:
- **Aplicarlo a todos los members, también a los que no tienen perfil:** cambia el comportamiento de upstream para instancias sin SSO (principio II). Se propone como issue a upstream.
- **Negar toda terminal a quien tenga solo lectura en algún entorno:** es más sencillo, pero quita al developer la terminal de staging.

## R8. Pantalla de SSO y comprobación de la configuración

**Decision**:
- **`groupProfilesCheck`:** añade `missingReadOnlyEnvironments` por grupo, con los nombres de `readOnly` que no coinciden con ningún entorno de los proyectos resueltos. Es un aviso, no un error: el entorno puede crearse después.
- **La pantalla de SSO:** lo muestra bajo el campo de perfiles, igual que los proyectos que faltan.

**Rationale**: una errata en `"production"` dejaría producción con acceso completo sin avisar. El
aviso la hace visible antes del primer login.

**Alternatives**: rechazar la configuración si el entorno no existe. Rompería el arranque cuando un
proyecto todavía no tiene su entorno de producción.

## R9. Eventos y log (FR-011)

**Decision**:
- **El evento:** cada denegación registra `member_profile`/`denied`/`read_only` con `userId`, `action` = el `path` del procedimiento (o `wss:docker-container-terminal`, `wss:terminal`) y un campo nuevo, `resource_id` = el id del servicio, entorno o proyecto afectado.
- **La columna:** `resource_id` es una columna opcional nueva en `oidc_sso_auth_event`, en la migración de R3.
- **El log:** la línea del contenedor sale de `formatAuthEventLine`, sin emails, con el `resource_id` añadido.
- **Errores de la guarda:** registran `member_profile`/`error`/`read_only_check_failed`.

**Rationale**: la spec pide quién, qué acción y qué servicio. Meter el servicio en `action` o en
`reason` mezclaría datos en campos que otras pantallas ya filtran.

**Alternatives**: no registrar las denegaciones de lectura enmascarada. No se registran: ocultar un
valor no es un intento de cambio.

## R10. Interfaz (FR-010)

**Decision**:
- **Qué sabe la interfaz:** `oidcSso.memberProfileStatus` devuelve además `readOnly: { environmentIds, serviceIds, projectIds }` del usuario actual. No hace falta ninguna consulta nueva: sale de la caché de R3.
- **El componente:** un componente del módulo, `ReadOnlyBoundary`, muestra una insignia «Solo lectura» y envuelve el contenido en `<fieldset disabled>`. Así desactiva los botones, campos y menús nativos de su interior.
- **Dónde se monta:** en las 8 páginas de servicio, alrededor de las pestañas que cambian cosas: general (acciones), entorno, dominios, avanzado y volúmenes, backups y tareas programadas. No se monta en logs, monitorización ni despliegues, porque ahí también hay botones de solo lectura (ver logs).
- **Botones que quedan activos:** los de cambio en despliegues (cancelar, rollback) siguen visibles. El servidor los rechaza con un mensaje claro (US4 es P3; la seguridad la da R4).

**Rationale**:
- Un único componente del módulo y puntos de montaje en upstream, sin reescribir cada botón (principio II).
- `fieldset disabled` es HTML estándar y cubre los controles que upstream añada dentro de esas pestañas.

**Alternatives**:
- **Pasar una prop `readOnly` a cada componente de upstream:** decenas de archivos tocados.
- **Ocultar las pestañas:** FR-002 pide ver la configuración no secreta.

## R11. Seguridad (ASVS 4.0, V4 Access Control)

- **V4.1.1 (el control se aplica en el servidor):** la guarda tRPC y la de WebSocket son el control. La interfaz solo informa (R10).
- **V4.1.2 (atributos no manipulables):** el alcance de solo lectura se calcula en el login y vive en el servidor. El member no puede enviarlo.
- **V4.1.3 (mínimo privilegio):** `qa` no recibe ninguno de los 11 permisos.
- **V4.1.5 (fallo cerrado):**
  - una mutación sin regla, un id ausente o un subrecurso no encontrado deniegan (R5);
  - un error al leer la caché deniega la petición entera, también las lecturas, para no filtrar secretos (NFR-SEC-001);
  - en la terminal, la inspección que falla deniega (R7).
- **V4.2.1 (IDOR):**
  - el destino de una mutación sale de la entrada, pero se compara con el alcance del servidor;
  - `lookup` resuelve el dueño real del subrecurso;
  - la terminal y los logs de contenedor ligan el contenedor al servicio, y los logs de despliegue ligan el despliegue al alcance (R7).
- **V8.3.4 (datos sensibles en respuestas):** ocultación por objeto, con prueba de deriva de columnas (R6).
- **V7.1.1 (logs sin datos sensibles):** los eventos no llevan emails ni valores (R9).
- **Revisión:** se ejecutará `/security-review` antes del PR.

## R12. Rendimiento (NFR-PERF-001)

| Camino | Coste añadido | Medición |
|---|---|---|
| Owner, admin, member sin perfil | 0 consultas: sale por rol o por `memberProfileCache` | bench: 0 lecturas de BD |
| Member con perfil sin solo lectura | 0 consultas: sale tras consultar la caché | bench: 0 lecturas de BD |
| Lectura tRPC con solo lectura | 0 consultas (salvo la carga única de la caché tras un reinicio); recorre la respuesta en memoria | bench: `project.all` con 200 proyectos, ≤ 5 ms p95 |
| Mutación con regla directa | 0 consultas | bench: ≤ 1 ms p95 |
| Mutación con `lookup` | 1 consulta por clave primaria | bench con PGlite: ≤ 5 ms p95 |
| Terminal o logs de contenedor (member con perfil) | 1 inspección de Docker, con un máximo de 5 s, al abrir la conexión | no es camino crítico; se mide en el lab |
| Log de despliegue (member con perfil) | 1 consulta por `logPath`, al abrir la conexión | bench con PGlite: ≤ 5 ms p95 |

Los benches se añaden a `performance.test.ts`, en un bloque `performance · read-only (spec 006)`.
