# Feature Specification: Los developers entran por SSO con su perfil y solo a sus proyectos

**Feature Branch**: `005-developer-access`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Spec 005 «developers»: los usuarios que entran a Dokploy por SSO (OIDC, spec 001) siendo miembros del grupo `developers` de milpia-infra deben recibir el rol member con un perfil de permisos propio y acceso solo a sus proyectos, recalculado en cada login, sin intervención manual de un admin. Hoy un usuario que entra por SSO fuera de ADMIN_GROUP recibe `member` sin ningún permiso ni proyecto asignado y no ve nada; los permisos individuales de member y las listas de alcance solo se asignan a mano. Objetivo: que el grupo decida el perfil y el alcance (principio VII), configurable por variables de entorno o la pantalla de SSO, sin fijar nombres de grupo en el código. Propuesta de partida: un developer ve y opera lo que ya existe en sus proyectos (desplegar, variables de entorno, dominios, logs), sin crear proyectos, servicios, entornos ni proveedores Git, sin Docker, Traefik, SSH keys ni API/CLI. Restricciones: sin roles personalizados enterprise ni código de /proprietary (principio I); desactivado por defecto e idéntico a upstream sin configurar, cambios de esquema solo aditivos (principio II); el owner nunca cambia; la spec 006 (qa solo lectura) reutilizará el alcance de esta. Contexto: modelo de acceso v4 aprobado por el owner el 2026-09-28. Infra añadirá developers a SSO_OIDC_ACCESS_GROUP y deploy_access_groups solo cuando esta spec esté en canary y probada en el lab."

## Contexto

Los grupos del proveedor de identidad son niveles de confianza (constitución, principio VII): `admins` y `leads` ya entran como admin (specs 001 y 002). Un usuario que entra por SSO sin estar en el grupo de administración recibe hoy el rol `member` **sin ningún permiso ni proyecto**: no ve nada hasta que un admin le marca a mano los permisos individuales y los proyectos a los que accede. Esta spec hace que el grupo decida ambas cosas en cada login, empezando por `developers`.

El mecanismo es genérico (perfiles y alcances por grupo, definidos en la configuración). `developers` es la primera configuración que usa Milpia. La spec 006 (qa en solo lectura) reutilizará el alcance de esta.

## Clarifications

### Session 2026-09-28

- Q: ¿Cómo se asignan los proyectos a un grupo? → A: Con una lista de proyectos por nombre para cada grupo, en la pantalla de SSO o en una variable de entorno (opción B). Cada proyecto nuevo se añade a la lista a mano.
- Q: ¿Operan los developers en producción? → A: Operan fuera de producción y en producción solo leen (opción C). Como la solo lectura es de la spec 006, la 005 excluye producción del alcance de developers (no la ven) y la 006 la abrirá en solo lectura.
- Q: ¿Pueden los developers crear y borrar servicios y entornos dentro de sus proyectos, fuera de producción? → A: No (opción A). Operan lo que ya existe en sus proyectos: desplegar, variables de entorno, dominios y logs. El alta de aplicaciones sigue pasando por el CLI y Vault (spec 013 de infra).
- Q: Cuando alguien sale del grupo, ¿pierde el acceso solo en su siguiente login por SSO o también tras unas horas? → A: En su siguiente login o, como mucho, 8 horas después de su último login por SSO (opción B, el mismo criterio que la spec 002). Pasado ese plazo, el perfil y el alcance dejan de aplicarse hasta que vuelva a entrar por SSO.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un developer entra y trabaja en sus proyectos sin esperar a un admin (Priority: P1)

Una persona del grupo `developers` entra por SSO por primera vez. Ve los proyectos que corresponden a su grupo y, dentro de ellos, puede desplegar sus servicios, cambiar variables de entorno y dominios, y ver logs y monitorización, sin que ningún admin haya tenido que configurar nada para ella.

**Why this priority**: es el objetivo de la spec. Sin esto, dar acceso a un developer exige trabajo manual por persona y el grupo no decide nada.

**Independent Test**: con un perfil y un alcance configurados para `developers`, un usuario nuevo del grupo entra por SSO y despliega un servicio de uno de sus proyectos sin que nadie toque su cuenta.

**Acceptance Scenarios**:

1. **Given** el perfil y el alcance de `developers` configurados, **When** un usuario del grupo entra por SSO por primera vez, **Then** entra como `member` con los permisos del perfil y ve exactamente los proyectos de su alcance.
2. **Given** un developer con sesión abierta, **When** despliega un servicio de uno de sus proyectos, cambia una variable de entorno o consulta sus logs, **Then** puede hacerlo.
3. **Given** un developer, **When** abre la lista de proyectos, **Then** no ve los proyectos que quedan fuera de su alcance.

---

### User Story 2 - Un developer no puede hacer lo que corresponde a admins y leads (Priority: P1)

Un developer no puede crear ni borrar proyectos, servicios ni entornos, gestionar la infraestructura (Docker, Traefik, SSH keys, servidores, registries), crear proveedores Git, crear claves de API ni gestionar usuarios, ni desde la interfaz ni llamando directamente al servidor.

**Why this priority**: un nivel de confianza menor tiene que serlo de verdad. Sin esta garantía, abrir el acceso a developers amplía el riesgo en prod.

**Independent Test**: con la cookie de un developer, intentar cada acción fuera de su perfil por llamada directa; todas se rechazan y no cambian nada.

**Acceptance Scenarios**:

1. **Given** un developer, **When** intenta crear o borrar un proyecto, un servicio o un entorno, **Then** el sistema lo rechaza, en la interfaz y por llamada directa.
2. **Given** un developer, **When** intenta acceder a Docker, a los archivos de Traefik, a las SSH keys o a los proveedores Git, **Then** el sistema lo rechaza.
3. **Given** un developer, **When** intenta operar un servicio de un proyecto fuera de su alcance, **Then** el sistema lo rechaza como si el proyecto no existiera para él.

---

### User Story 3 - El owner define perfiles y alcances por grupo y ve de dónde salen los permisos (Priority: P2)

El owner configura, desde la pantalla de SSO o por variables de entorno, qué permisos y qué alcance recibe cada grupo. En la lista de usuarios, un admin ve que los permisos de un developer vienen de su grupo, para no editarlos a mano esperando que duren.

**Why this priority**: sin configuración no hay perfil que aplicar; y sin indicar el origen, un admin edita permisos que se pierden en el siguiente login.

**Independent Test**: definir el perfil de `developers` por variable de entorno, comprobar que aparece bloqueado en la pantalla de SSO y que, en la lista de usuarios, un developer muestra que sus permisos vienen del grupo.

**Acceptance Scenarios**:

1. **Given** el perfil definido por variable de entorno, **When** el owner abre la pantalla de SSO, **Then** ve el valor bloqueado, como los demás ajustes que vienen del entorno.
2. **Given** una configuración con un permiso desconocido o mal escrita, **When** el owner intenta guardarla o el servidor arranca con ella, **Then** el sistema la rechaza con un mensaje que dice qué está mal y no aplica perfiles a medias.
3. **Given** un developer con perfil de grupo, **When** un admin abre sus permisos, **Then** ve que vienen del grupo y que un cambio manual se perderá en su siguiente login por SSO.

---

### User Story 4 - Un cambio de grupo se refleja en el siguiente login (Priority: P2)

Cuando una persona sale del grupo `developers` o cambia de grupo en el proveedor de identidad, en su siguiente login por SSO pierde el perfil y el alcance anteriores y recibe los nuevos.

**Why this priority**: revocar acceso tiene que ser tan automático como darlo, o se acumulan permisos que nadie revisa (principio VII).

**Independent Test**: sacar a un usuario de `developers` en el proveedor, que vuelva a entrar por SSO y comprobar que ya no ve los proyectos ni tiene los permisos del perfil.

**Acceptance Scenarios**:

1. **Given** un developer, **When** sale del grupo y vuelve a entrar por SSO, **Then** pierde los permisos y el alcance del perfil.
4. **Given** un developer cuyo último login por SSO fue hace más de 8 horas, **When** abre el panel o intenta operar un servicio, **Then** el perfil y el alcance ya no se aplican y el panel le indica que vuelva a iniciar sesión por SSO; tras hacerlo, recupera el acceso si sigue en el grupo.
2. **Given** un developer, **When** pasa a `leads` y vuelve a entrar, **Then** entra como admin y el perfil de developer deja de aplicarse.
3. **Given** el owner cambia el alcance de `developers`, **When** un developer vuelve a entrar por SSO, **Then** ve el alcance nuevo.

---

### User Story 5 - Sin configuración, nada cambia (Priority: P3)

Una instancia que actualiza el fork sin configurar perfiles ni alcances se comporta exactamente igual que hoy: los members que entran por SSO no reciben nada y los permisos que un admin puso a mano siguen intactos.

**Why this priority**: principio II. Sin esto, actualizar la imagen cambiaría permisos en prod sin que nadie lo haya decidido.

**Independent Test**: actualizar sin configurar nada; las pruebas actuales de permisos pasan sin modificarse y los permisos manuales existentes no cambian tras un login por SSO.

**Acceptance Scenarios**:

1. **Given** ningún perfil configurado, **When** un member entra por SSO, **Then** sus permisos y su alcance no cambian.
2. **Given** un perfil solo para `developers`, **When** entra un member que no está en ningún grupo con perfil, **Then** sus permisos manuales no cambian.

### Edge Cases

- Una persona en `developers` y en `leads`: gana el rol más alto (admin) y el perfil de member no se aplica.
- Una persona en dos grupos con perfil de member (por ejemplo `developers` y, en la spec 006, `qa`): recibe la unión de permisos y de alcances. La spec 006 decide cómo se combina con la solo lectura.
- El owner está en `developers`: su rol nunca cambia y no se le aplica ningún perfil.
- Un developer tiene una sesión abierta cuando el owner cambia el perfil: el cambio se aplica en su siguiente login por SSO o, como mucho, 8 horas después de su último login por SSO (FR-017).
- Un developer sale del grupo y no vuelve a entrar: conserva el acceso como mucho 8 horas desde su último login por SSO. El owner puede cerrar su sesión si es urgente.
- El alcance nombra un proyecto que no existe o que se borró: se ignora y el resto del alcance se aplica; la pantalla de SSO lo señala.
- Se crea un proyecto nuevo: nadie de `developers` lo ve hasta que se añade a la lista de su alcance; a partir de entonces, lo ven en su siguiente login por SSO.
- Un proyecto se renombra: deja de coincidir con la lista hasta que se actualiza el nombre en ella; la pantalla de SSO señala los nombres de la lista que no existen.
- Un proyecto de la lista no tiene un entorno con el nombre excluido: el alcance cubre todos sus entornos.
- Un admin cambia a mano los permisos de un developer: el cambio dura hasta su siguiente login por SSO, donde el grupo vuelve a mandar (US3-3).
- Un member que entra con la cuenta local (sin SSO) no recibe perfil: los perfiles solo se aplican en el login por SSO.
- El owner vacía `groupProfiles` (o la variable deja de ser válida): se vuelve al comportamiento de upstream (FR-013). Los permisos y proyectos que los members ya tenían se quedan como si un admin los hubiera puesto a mano: no caducan ni se revocan solos. La lista de usuarios sigue marcándolos con «SSO: <grupos>» para que un admin los revise, y no los muestra como caducados.
- Un member abre la terminal, los logs o las estadísticas de un contenedor por WebSocket sin pasar por el resto del panel: la caducidad de FR-017 también se comprueba ahí, antes de autorizar la conexión.
- Se cambia el grupo de acceso sin incluir a `developers`: no pueden entrar, con o sin perfil (spec 001).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El owner MUST poder definir, desde la pantalla de SSO o por variable de entorno, un **perfil de permisos por grupo**: qué permisos individuales de member recibe cada grupo del proveedor de identidad. El valor del entorno manda y aparece bloqueado, como el resto de ajustes del SSO.
- **FR-002**: El owner MUST poder definir, con la misma precedencia, un **alcance por grupo**: una lista de proyectos por nombre para cada grupo y, opcionalmente, los entornos de esos proyectos a los que accede o los que excluye, también por nombre. Sin entornos indicados, el alcance cubre todos los entornos de los proyectos de la lista. Un proyecto nuevo solo entra en el alcance cuando se añade a la lista.
- **FR-003**: En cada login por SSO de un usuario con rol `member` que pertenece a uno o más grupos con perfil o alcance configurado, el sistema MUST sustituir sus permisos individuales y su alcance por los que resultan de sus grupos. Lo que un admin haya puesto a mano no se conserva.
- **FR-004**: Si un usuario con rol `member` deja de pertenecer a todo grupo con perfil o alcance, el sistema MUST quitarle en su siguiente login por SSO los permisos y el alcance que recibió de los grupos, dejándolo sin ninguno.
- **FR-005**: El sistema MUST NOT cambiar los permisos ni el alcance de un member que nunca recibió un perfil de grupo y no pertenece a ningún grupo con perfil: su configuración manual sigue siendo la de upstream.
- **FR-006**: Si el usuario pertenece a varios grupos con perfil, el sistema MUST aplicar la unión de sus permisos y de sus alcances.
- **FR-007**: El perfil y el alcance MUST aplicarse solo a usuarios con rol `member`. El owner nunca cambia (spec 001) y un admin no recibe perfil: si un usuario pertenece al grupo de administración y a un grupo con perfil, gana el rol admin.
- **FR-008**: Un perfil MUST poder otorgar solo los permisos individuales que ya existen para member en upstream (crear o borrar proyectos, servicios y entornos; acceso a Docker, a la API, a las SSH keys, a los proveedores Git y a los archivos de Traefik). La funcionalidad MUST NOT dar a un member ningún permiso que upstream reserve a admin.
- **FR-009**: El sistema MUST rechazar una configuración con un permiso desconocido, un grupo vacío o un formato inválido, con un mensaje que diga qué falla, y MUST NOT aplicar perfiles a medias. Si la configuración del entorno es inválida al arrancar, los perfiles MUST quedar desactivados y el sistema MUST registrarlo.
- **FR-010**: Las comprobaciones de permisos y de alcance MUST cumplirse en el servidor, también en peticiones que no vienen de la interfaz, con las mismas reglas que upstream aplica hoy a un member con esos permisos y ese alcance.
- **FR-011**: La lista de usuarios MUST indicar, para un member con perfil de grupo, que sus permisos y su alcance vienen de sus grupos y que un cambio manual se perderá en su siguiente login por SSO.
- **FR-012**: Los cambios de perfiles y alcances en la pantalla de SSO MUST registrarse en los eventos del SSO como cambios de configuración, igual que el resto de ajustes.
- **FR-013**: Sin perfiles ni alcances configurados, el sistema MUST comportarse exactamente como hoy.
- **FR-014**: La funcionalidad MUST NOT depender de roles personalizados ni de ningún código bajo licencia enterprise. Si el usuario tiene un rol personalizado, el sistema MUST NOT aplicarle perfil.
- **FR-015**: Los nombres de grupo, los permisos de cada perfil y el alcance MUST vivir en la configuración; el código MUST NOT fijar ninguno.
- **FR-016**: El alcance MUST poder excluir entornos por nombre, para que un grupo opere sus proyectos fuera de producción. En esta spec, un entorno excluido no es visible para el grupo. Ver producción en solo lectura llegará con la spec 006, que añadirá al alcance un nivel de acceso de solo lectura por entorno.
- **FR-017**: El perfil y el alcance que un member recibe de sus grupos MUST caducar 8 horas después de su último login por SSO. Pasado ese plazo, el sistema MUST dejar de aplicarlos (el member queda sin esos permisos ni ese alcance) y MUST indicarle en el panel que vuelva a iniciar sesión por SSO, sin cerrar su sesión. Los permisos manuales de los members sin perfil de grupo no caducan (FR-005).

### Key Entities

- **Perfil de grupo**: un grupo del proveedor de identidad y los permisos individuales de member que otorga.
- **Alcance de grupo**: un grupo del proveedor de identidad y los proyectos (y entornos) a los que da acceso.
- **Origen de los permisos de un miembro**: constancia de que los permisos y el alcance actuales de un member vienen de sus grupos, de qué grupos y de qué login por SSO, para poder quitarlos cuando deje de pertenecer (FR-004) y avisar en la lista de usuarios (FR-011).

### Non-Functional Requirements

- **NFR-PERF-001**: Aplicar el perfil y el alcance MUST añadir como máximo 50 ms (p95) al login por SSO.
- **NFR-PERF-002**: Comprobar la caducidad (FR-017) MUST añadir como máximo 5 ms (p95) a cada petición de un member con perfil de grupo, y MUST NOT añadir consultas ni tiempo a las peticiones del owner, de los admins ni de los members sin perfil de grupo.
- **NFR-SEC-001**: Cualquier error al calcular el perfil o el alcance durante el login (configuración ilegible, fallo de base de datos) MUST resolverse dejando al usuario sin los permisos y el alcance del perfil, nunca con permisos de más, y MUST registrar un evento de error con su referencia.
- **NFR-SEC-002**: Un member MUST NOT poder ampliar su propio perfil ni su alcance por ninguna vía.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un developer nuevo puede desplegar un servicio de uno de sus proyectos en su primer login por SSO, con 0 pasos manuales de un admin.
- **SC-002**: El 100 % de las acciones fuera del perfil de developer (crear o borrar proyectos, servicios o entornos, Docker, Traefik, SSH keys, proveedores Git, gestión de usuarios, proyectos fuera de su alcance) se rechazan, tanto desde la interfaz como por llamada directa.
- **SC-003**: Al sacar a una persona del grupo, pierde el perfil y el alcance en su siguiente login por SSO o, como mucho, 8 horas después de su último login por SSO, en el 100 % de los casos.
- **SC-004**: Una instancia que actualiza sin configurar perfiles no cambia de comportamiento: las pruebas actuales de permisos pasan sin modificarse y ningún permiso manual existente cambia.
- **SC-005**: El login por SSO de un developer tarda como mucho 50 ms más (p95) que el de un member sin perfil.

## Assumptions

- La configuración de Milpia para `developers` (confirmada por el owner en el clarify) sigue la propuesta de infra: ver y operar lo que ya existe en sus proyectos (desplegar, variables de entorno, dominios, backups, logs y monitorización), **sin** crear ni borrar proyectos, servicios ni entornos, **sin** proveedores Git (las apps se despliegan por imagen de GHCR fijada por SHA con el CLI, spec 013 de infra; la GitHub App de Dokploy se borró el 27/09), **sin** Docker, Traefik ni SSH keys, y **sin** API ni CLI (P10: solo admins y leads). Con esa configuración, el perfil de `developers` no otorga ninguno de los permisos individuales, y lo que opera dentro de sus proyectos viene de lo que upstream ya permite a un member en su alcance.

- «Sin proveedores Git» significa que el developer no los crea ni los gestiona. Los proveedores que un admin comparta con toda la organización los sigue viendo, como cualquier member en upstream (`getAccessibleGitProviderIds`). El owner lo aceptó el 2026-10-04 (MIL-535, opción a): hoy no hay proveedores compartidos, y ocultarlos añadiría divergencia con upstream. Si se comparte uno que los developers no deban ver, se reabre MIL-535.
- Lo que un member puede hacer dentro de los servicios de su alcance (desplegar, variables de entorno, dominios, backups, logs) lo fija upstream y esta spec no lo cambia; limitarlo es trabajo de la spec 006 (solo lectura).
- El entorno de producción de cada proyecto se llama `production`, que es el nombre por defecto de Dokploy. La configuración de Milpia para `developers` será: sus proyectos por nombre, excluyendo el entorno `production`.
- El alcance cubre todos los servicios de los entornos incluidos, también los que un admin cree después; el developer los ve a partir de su siguiente login por SSO.
- Hasta la spec 006, los developers no ven producción. Consultar logs o el estado de prod sigue en manos de leads y admins.
- El perfil se recalcula en el login por SSO, como el rol (spec 001) y el grupo de gestión (spec 002), y caduca a las 8 horas del último login por SSO, igual que el permiso de gestión de usuarios de la spec 002. Si un cambio es más urgente, el owner cierra la sesión.
- Infra añadirá `developers` a `SSO_OIDC_ACCESS_GROUP` y a `deploy_access_groups` solo cuando esta spec esté en canary y probada en el lab; antes, los developers no pueden entrar.
- El acceso al CLI y a la API se controla en infra (oauth2-proxy y Vault). Que un developer tenga o no el permiso de API en Dokploy no le da acceso al CLI.
