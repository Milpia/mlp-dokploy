# Feature Specification: Solo lectura por entorno para qa y para ver producción

**Feature Branch**: `006-read-only-access`

**Created**: 2026-09-28

**Status**: Ready

**Input**: User description: "Spec 006 «qa y lectura de producción»: añadir al alcance por grupo de la spec 005 un nivel de acceso de SOLO LECTURA por entorno, y usarlo para (a) el grupo `qa` de milpia-infra, que revisa los entornos no productivos del proyecto `milpia` sin cambiar nada, y (b) los `developers`, que operan fuera de producción (spec 005) y deben poder VER producción sin cambiarla. Hoy upstream da a cualquier member con un servicio en su alcance la capacidad fija de desplegar, cancelar despliegues, escribir variables de entorno, dominios, volúmenes, backups y restores y tareas programadas; no existe un member de solo lectura sin roles personalizados enterprise, que están prohibidos (principio I). Solo lectura significa ver proyectos, entornos, servicios, su estado, logs, monitorización e historial de despliegues; no desplegar, cancelar, reiniciar, cambiar variables de entorno, dominios, volúmenes, backups, restores ni tareas programadas, ni abrir la terminal de un contenedor. La regla debe cumplirse en el servidor por todas las vías (tRPC, API pública con clave, WebSockets), con fallo cerrado. Configuración en el mismo `groupProfiles` de la 005. Mismas reglas de la 005: recalculado en cada login, caducidad a 8 h, sin código de /proprietary, desactivado por defecto, esquema aditivo, nombres en la configuración. Infra añadirá qa al grupo de acceso solo cuando esta spec esté en canary y probada en el lab."

## Clarifications

### Session 2026-09-28

- Q: En un entorno de solo lectura, ¿el usuario ve los valores de las variables de entorno? → A: Solo los nombres, sin los valores (opción A). Protege los secretos y permite ver si falta una variable.
- Q: Si una persona está en un grupo con acceso completo y en otro con solo lectura sobre el mismo entorno, ¿qué gana? → A: El acceso completo (opción A). Los grupos suman permisos, como en la spec 005.
- Q: En un entorno de solo lectura, ¿puede el usuario descargar o ver el contenido de los backups de sus bases de datos? → A: No (opción A). Ve la lista de backups y su estado (fecha, resultado, tamaño), pero no puede descargarlos ni ver su contenido.
- Q: Si un proyecto tiene algún entorno de solo lectura para una persona, ¿puede cambiar las variables de entorno compartidas del proyecto? → A: No (opción A). Las variables del proyecto llegan a todos sus entornos, así que también son de solo lectura: ve los nombres sin valores, y tampoco puede borrar ni duplicar el proyecto.
- Q: ¿Una persona con algún entorno de solo lectura puede abrir la terminal del servidor? → A: No (opción A). Una shell del servidor llega a todos los entornos que corren en él. Tampoco puede usar las acciones de Docker del servidor (contenedores, volúmenes, imágenes, redes), que no se pueden ligar a un entorno.
- Q: En un entorno de solo lectura, ¿se ve el contenido de los archivos montados en un servicio? → A: No (opción A). Se ven la ruta y el tipo de cada archivo montado, con el contenido enmascarado: el panel no puede saber qué parte del archivo es secreta.
- Q: ¿La comprobación de que un contenedor pertenece al servicio se aplica a todos los members con perfil o solo a los que tienen solo lectura? → A: A todos los members con perfil de grupo (opción A), en la terminal y en los logs de contenedor. Los members sin perfil siguen con el comportamiento de upstream.
- Q: En un entorno de solo lectura, ¿se ve el contenido del compose, del Dockerfile y de la configuración de build? → A: No. Se ocultan el contenido del compose y los comandos personalizados; se ven el tipo de build, la rama, el repositorio y la ruta del Dockerfile (el panel no guarda el contenido del Dockerfile).
- Q: ¿Esta spec cierra también el hueco de los logs de despliegue en directo, que cualquier member puede seguir fuera de su alcance y con el perfil caducado? → A: Sí (opción A), para los members con perfil de grupo: se comprueban el alcance y la caducidad antes de enviar el log.

## Contexto

La spec 005 da a cada grupo un perfil y un alcance (proyectos y entornos). Pero dentro de su alcance, upstream deja a **cualquier** member desplegar, cancelar, cambiar variables de entorno, dominios, volúmenes, backups, restores y tareas programadas. Un member de solo lectura no existe en upstream sin roles personalizados enterprise, que el principio I prohíbe.

Esta spec añade al alcance de un grupo un **nivel de acceso por entorno**: completo, como hoy, o **solo lectura**. Sirve para dos casos del modelo de acceso v4:
- **qa** revisa los entornos no productivos de `milpia` sin cambiar nada.
- **developers** siguen operando fuera de producción y, además, **ven** producción sin poder tocarla (decisión Q2: C de la 005).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - qa revisa sin poder cambiar nada (Priority: P1)

Una persona del grupo `qa` entra por SSO y ve los servicios de los entornos que le corresponden: estado, logs, monitorización e historial de despliegues. No puede desplegar, reiniciar, cambiar variables ni tocar nada, ni desde la interfaz ni llamando directamente al servidor.

**Why this priority**: es lo que falta para abrir el acceso a qa. Sin esto, un qa con alcance puede desplegar y cambiar secretos como un developer.

**Independent Test**: con el perfil de `qa` en solo lectura, un usuario del grupo ve sus servicios y cada intento de cambio (desplegar, variable de entorno, dominio, backup, terminal) se rechaza por la interfaz y por llamada directa.

**Acceptance Scenarios**:

1. **Given** el perfil de `qa` con sus entornos en solo lectura, **When** un usuario del grupo entra por SSO, **Then** ve los proyectos, entornos y servicios de su alcance, su estado, logs, monitorización e historial de despliegues.
2. **Given** un usuario de `qa`, **When** intenta desplegar, cancelar un despliegue, reiniciar o parar un servicio, **Then** el sistema lo rechaza.
3. **Given** un usuario de `qa`, **When** intenta cambiar variables de entorno, dominios, volúmenes, backups, restores o tareas programadas, **Then** el sistema lo rechaza.
4. **Given** un usuario de `qa`, **When** intenta abrir la terminal de un contenedor, **Then** el sistema lo rechaza; ver los logs del contenedor sí funciona.

---

### User Story 2 - developers ven producción sin poder cambiarla (Priority: P1)

Un developer sigue operando sus entornos no productivos como en la spec 005, y ahora también ve producción en solo lectura: estado, logs y monitorización, para diagnosticar sin pedírselo a un lead.

**Why this priority**: cierra la decisión Q2: C de la 005 (fuera de producción opera, en producción lee). Hasta ahora producción queda oculta para developers.

**Independent Test**: con el perfil de `developers` que marca producción como solo lectura, un developer despliega en staging y en producción solo puede ver.

**Acceptance Scenarios**:

1. **Given** el perfil de `developers` con producción en solo lectura, **When** un developer abre un servicio de producción, **Then** ve su estado, logs, monitorización e historial de despliegues.
2. **Given** ese developer, **When** intenta desplegar o cambiar una variable de entorno en producción, **Then** el sistema lo rechaza.
3. **Given** ese developer, **When** despliega en staging, **Then** funciona como en la spec 005.
4. **Given** ese developer, **When** intenta cambiar las variables de entorno compartidas del proyecto que contiene producción, **Then** el sistema lo rechaza y ve sus nombres sin valores.

---

### User Story 3 - La restricción se cumple por todas las vías y caduca igual (Priority: P2)

La solo lectura no depende de la interfaz: se cumple en el servidor, también con claves de API y en las conexiones de logs y terminal de contenedores, y se recalcula en cada login y caduca a las 8 h como el resto del perfil.

**Why this priority**: una restricción que solo oculta botones no protege nada. Es la garantía de seguridad de la spec.

**Independent Test**: con la cookie o una clave de API de un usuario de solo lectura, cada llamada directa de cambio sobre un servicio de solo lectura se rechaza; la terminal por WebSocket también.

**Acceptance Scenarios**:

1. **Given** un usuario con un entorno en solo lectura, **When** llama directamente al servidor para desplegar un servicio de ese entorno, **Then** el sistema lo rechaza sin cambiar nada.
2. **Given** ese usuario, **When** abre la terminal de un contenedor de ese entorno por WebSocket, **Then** la conexión se rechaza.
3. **Given** un usuario de `qa`, **When** sale del grupo o pasan 8 horas desde su último login por SSO, **Then** pierde el acceso como en la spec 005.
4. **Given** un member con perfil de grupo y acceso a un servicio, **When** pide la terminal o los logs de un contenedor que no pertenece a ese servicio, **Then** la conexión se rechaza.
5. **Given** un member con perfil de grupo, **When** pide el log en directo de un despliegue de un servicio fuera de su alcance, o con su perfil caducado, **Then** la conexión se rechaza.
6. **Given** un usuario con algún entorno de solo lectura, **When** intenta abrir la terminal de un servidor o reiniciar un contenedor desde la vista de Docker del servidor, **Then** el sistema lo rechaza.
7. **Given** un member cuyo conjunto de solo lectura cambia (porque su perfil caducó o porque la configuración cambió), **When** vuelve a entrar por SSO y, sin que Dokploy se reinicie, intenta un cambio en un entorno que ahora es de solo lectura, **Then** el sistema lo rechaza desde la primera llamada (FR-008, MIL-573).

---

### User Story 4 - La interfaz no ofrece lo que no se puede hacer (Priority: P3)

En los servicios de solo lectura, la interfaz no muestra (o desactiva) los botones de desplegar, reiniciar, guardar variables y demás acciones, y deja claro que el acceso es de solo lectura.

**Why this priority**: evita errores y confusión, pero la seguridad ya la da el servidor (US3).

**Independent Test**: un usuario de `qa` abre un servicio y no encuentra acciones de cambio activas; ve un indicador de solo lectura.

**Acceptance Scenarios**:

1. **Given** un usuario de `qa`, **When** abre un servicio de su alcance, **Then** ve un indicador de solo lectura y las acciones de cambio no están disponibles.

---

### User Story 5 - Sin configuración, nada cambia (Priority: P3)

Sin ningún entorno marcado como solo lectura, el sistema se comporta exactamente como con la spec 005.

**Why this priority**: principio II; actualizar la imagen no cambia nada que nadie haya decidido.

**Independent Test**: con los perfiles de la 005 sin solo lectura, los tests actuales pasan sin cambios y un developer sigue desplegando en su alcance.

**Acceptance Scenarios**:

1. **Given** perfiles sin solo lectura, **When** un developer despliega en su alcance, **Then** funciona como hoy.

### Edge Cases

- Un servicio nuevo en un entorno de solo lectura: hereda la solo lectura en el siguiente login por SSO del usuario, como el alcance de la 005.
- Un admin o el owner: nunca tienen solo lectura; los perfiles solo se aplican a members (spec 005, FR-007).
- Un member sin perfil de grupo: sus permisos manuales no cambian y nunca es de solo lectura (spec 005, FR-005).
- Una llamada que lee pero la interfaz usa como paso previo a una escritura: se permite la lectura y se rechaza la escritura.
- El entorno de solo lectura se renombra: deja de coincidir hasta que se actualiza la configuración, igual que en la 005.
- Una clave de API de un usuario de solo lectura: tiene exactamente sus permisos, también la solo lectura.
- La solo lectura se quita de la configuración: el cambio se aplica en el siguiente login por SSO del usuario o, como mucho, a las 8 h.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El owner MUST poder marcar, en el perfil de un grupo de la spec 005, qué entornos de su alcance son de **solo lectura**: todos los del grupo o una lista por nombre. El resto de entornos del alcance tiene acceso completo, como en la 005.
- **FR-002**: En un servicio de un entorno de solo lectura, el sistema MUST permitir ver el proyecto, el entorno, el servicio, su estado, su configuración no secreta, sus logs, su monitorización y su historial de despliegues.
- **FR-003**: En un servicio de un entorno de solo lectura, el sistema MUST rechazar: desplegar, volver a desplegar, cancelar un despliegue, arrancar, parar o reiniciar; crear, cambiar o borrar variables de entorno, dominios, volúmenes, backups, restores y tareas programadas; y cualquier otra acción que cambie el servicio o su configuración.
- **FR-003a**: Si un proyecto contiene algún entorno de solo lectura para el usuario, el sistema MUST rechazar que cambie las variables de entorno compartidas del proyecto, que borre el proyecto o que lo duplique, y MUST aplicar FR-006 a esas variables. Como el nombre y la descripción del proyecto se guardan en la misma operación que sus variables, también quedan de solo lectura para ese usuario.
- **FR-004**: En un servicio de un entorno de solo lectura, el sistema MUST rechazar abrir la terminal de sus contenedores. Ver sus logs y estadísticas MUST seguir permitido.
- **FR-004a**: A un usuario con algún entorno de solo lectura, el sistema MUST rechazarle abrir la terminal de un servidor y las acciones de Docker que actúan sobre el servidor y no sobre un servicio concreto (contenedores, volúmenes, imágenes y redes), porque no se pueden limitar a un entorno.
- **FR-004b**: Al abrir la terminal o los logs de un contenedor, el sistema MUST comprobar, para todo member con perfil de grupo (tenga o no entornos de solo lectura), que el contenedor pertenece al servicio por el que se pide, y MUST rechazar la conexión si no pertenece o si no se puede comprobar. A los members sin perfil no se les aplica (FR-009).
- **FR-004c**: Antes de enviar en directo el log de un despliegue a un member con perfil de grupo, el sistema MUST comprobar que el despliegue pertenece a un servicio de su alcance y que su perfil no ha caducado (FR-008), y MUST rechazar la conexión si no se cumple o si no se puede comprobar. Ver ese log sigue siendo lectura, también en entornos de solo lectura (FR-002).
- **FR-005**: Las restricciones de FR-003, FR-003a, FR-004, FR-004a, FR-004b y FR-004c MUST cumplirse en el servidor por todas las vías (la interfaz, llamadas directas, claves de API y conexiones WebSocket), con fallo cerrado: un error al comprobarlas deniega la acción.
- **FR-006**: En un servicio de un entorno de solo lectura, el sistema MUST mostrar los **nombres** de las variables de entorno (del servicio, del entorno y del proyecto) y MUST NOT devolver sus **valores**, por ninguna vía. Lo mismo aplica a cualquier otro campo secreto de la configuración del servicio (contraseñas de bases de datos, tokens) al contenido de los archivos montados, de los que se muestran la ruta y el tipo, y al contenido del compose y a los comandos personalizados, de los que se muestran el tipo de build, la rama, el repositorio y la ruta del Dockerfile.
- **FR-006a**: En un servicio de un entorno de solo lectura, el sistema MUST mostrar la lista de backups y su estado (fecha, resultado, tamaño) y MUST rechazar descargarlos o leer su contenido, por ninguna vía.
- **FR-007**: Si una persona está en un grupo que da acceso completo a un entorno y en otro que lo da en solo lectura, gana el **acceso completo**: los grupos suman, como en la spec 005 (FR-006 de la 005). Un entorno es de solo lectura para el usuario solo si ninguno de sus grupos le da acceso completo a él.
- **FR-008**: La solo lectura MUST recalcularse en cada login por SSO y caducar con el perfil a las 8 horas, como el resto de la spec 005.
- **FR-009**: La solo lectura MUST aplicarse solo a members con perfil de grupo; nunca al owner, a los admins ni a members sin perfil.
- **FR-010**: En los servicios de solo lectura, la interfaz MUST indicar que el acceso es de solo lectura y MUST NOT ofrecer como disponibles las acciones que FR-003 y FR-004 rechazan.
- **FR-011**: Un intento rechazado por la solo lectura MUST registrarse en los eventos del SSO (con quién, la acción y el servicio) y en el log del contenedor sin emails, como los de la spec 002 y la T062.
- **FR-012**: Sin ningún entorno marcado como solo lectura, el sistema MUST comportarse exactamente como con la spec 005.
- **FR-013**: La funcionalidad MUST NOT depender de roles personalizados ni de código bajo licencia enterprise, y los nombres de grupo y de entorno MUST vivir en la configuración.
- **FR-014**: Una configuración de solo lectura inválida (entorno fuera del alcance del grupo, formato incorrecto) MUST rechazarse entera con un mensaje, como en la spec 005.

### Key Entities

- **Nivel de acceso por entorno**: para cada entorno del alcance de un member, completo o solo lectura, derivado de sus grupos en cada login.
- **Constancia de origen** (de la spec 005): se amplía para saber qué entornos o servicios del member son de solo lectura.

### Non-Functional Requirements

- **NFR-PERF-001**: Comprobar la solo lectura MUST añadir como máximo 5 ms (p95) a cada acción de cambio de un member con perfil. MUST NOT añadir consultas a las peticiones de lectura tRPC, salvo una carga única del alcance de solo lectura por usuario tras un reinicio del proceso, ni añadir nada a las peticiones del owner, de los admins o de los members sin perfil. Al abrir una conexión WebSocket de un member con perfil (FR-004b, FR-004c), la comprobación MUST costar como máximo una consulta de ≤ 5 ms (p95) o una inspección del contenedor con un tiempo máximo de 5 s, una sola vez por conexión y nunca por mensaje.
- **NFR-SEC-001**: Cualquier error al comprobar la solo lectura MUST resolverse denegando la acción.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un usuario de `qa` ve el estado, los logs y el historial de despliegues de todos los servicios de su alcance en su primer login por SSO, con 0 pasos manuales de un admin.
- **SC-002**: El 100 % de las acciones de cambio de FR-003, FR-003a, FR-004 y FR-004a, de las conexiones a contenedores o logs de despliegue ajenos de FR-004b y FR-004c, y de las descargas de backups de FR-006a, sobre servicios de solo lectura se rechazan, por la interfaz, por llamada directa, con clave de API y por WebSocket.
- **SC-003**: Un developer ve producción y despliega en staging en la misma sesión, sin rechazos en staging.
- **SC-004**: Con perfiles sin solo lectura, las pruebas actuales pasan sin cambios.

## Assumptions

- Configuración de Milpia prevista (el formato exacto se fija en el plan):
  - `qa`: proyecto `milpia`, sin producción, todo en solo lectura.
  - `developers`: proyecto `milpia`, con producción en solo lectura y el resto completo (hoy producción está excluida en la 005).
- Ver logs y estadísticas de un contenedor es lectura; abrir su terminal no lo es (una shell permite cambiar cosas).
- Upstream ya decide qué ve un member en su alcance; esta spec solo restringe lo que puede cambiar en los entornos de solo lectura.
- Infra añadirá `qa` a `SSO_OIDC_ACCESS_GROUP` y a `deploy_access_groups` (en el panel, no en la API) solo cuando esta spec esté en canary y probada en el lab.
- Un developer que es también qa conserva el acceso completo en staging y ve producción en solo lectura (FR-007).
