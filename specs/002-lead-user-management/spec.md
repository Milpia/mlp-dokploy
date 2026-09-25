# Feature Specification: Los leads operan como admin pero no gestionan usuarios

**Feature Branch**: `002-lead-user-management`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "Los usuarios que entran a Dokploy por SSO (OIDC, spec 001) siendo miembros del grupo `leads` de milpia-infra deben poder operar como un admin (proyectos, servicios, despliegues, Docker, Traefik, proveedores Git), pero NO gestionar usuarios: no pueden borrar cuentas, invitar usuarios, cambiar el rol de otros (ascender o degradar) ni cambiar los permisos de otros miembros. La gestión de usuarios queda solo para los usuarios del grupo `admins` y el owner de la instancia. Cerrar sesiones ajenas ya está restringido al owner por upstream y queda fuera de alcance. Contexto: infra spec 014 configura SSO_OIDC_ACCESS_GROUP=admins,leads y SSO_OIDC_ADMIN_GROUP=admins,leads; esta mejora no bloquea la 014. Restricciones: los roles personalizados de Dokploy exigen licencia enterprise (código /proprietary) y no se pueden usar (Principio I); minimizar la divergencia con upstream (Principio II); el rol se recalcula en cada login (spec 001 FR-007); el owner nunca cambia de rol. Pregunta abierta: qué pasa con un usuario que pertenece a `admins` y a `leads` a la vez."

## Clarifications

### Session 2026-09-25

- Q: ¿Cómo se debe decidir quién puede gestionar usuarios entre los admins que entran por SSO? → A: Lista de permitidos: solo gestionan usuarios los admins que están en el grupo de gestión (en Milpia, `admins`); quien está en `admins` y `leads` sí gestiona.
- Q: Con el grupo de gestión configurado, ¿qué pasa con un admin que nunca ha entrado por SSO (tiene cuenta local con contraseña)? → A: No puede gestionar usuarios hasta que entre por SSO y su grupo lo confirme; el owner queda exento.
- Q: Si en el proveedor de identidad sacan a alguien del grupo `admins`, ¿basta con que pierda la gestión de usuarios en su siguiente login por SSO, o hay que quitársela también en las sesiones que ya tiene abiertas? → A: Pierde la gestión en su siguiente login por SSO y, además, el permiso de gestión caduca a las 8 horas del último login por SSO; para recuperarlo hay que volver a entrar por SSO.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un lead opera la plataforma sin poder tocar las cuentas de otros (Priority: P1)

Una persona del grupo `leads` inicia sesión en Dokploy por SSO. Puede crear y borrar proyectos, desplegar servicios, revisar Docker y Traefik y configurar proveedores Git, igual que un admin. Pero en la gestión de usuarios no ve las acciones de borrar, invitar, cambiar rol ni cambiar permisos, y si intenta ejecutarlas por otra vía (API, petición manual) el sistema las rechaza.

**Why this priority**: Es el objetivo de la funcionalidad. La spec 014 de infra da el rol admin a los leads; sin esta restricción un lead puede quitar el acceso a un compañero o darle privilegios que el proveedor de identidad no le concedió.

**Independent Test**: Con el grupo de gestión de usuarios configurado como `admins`, un usuario que solo está en `leads` entra por SSO, despliega un servicio con éxito e intenta borrar a un miembro, invitar a alguien, ascender a un miembro a admin y cambiarle permisos. Las cuatro acciones se rechazan y el miembro queda igual.

**Acceptance Scenarios**:

1. **Given** un usuario que pertenece a `leads` pero no al grupo de gestión de usuarios, **When** entra por SSO, **Then** recibe el rol admin y puede usar todas las capacidades de admin que no son gestión de usuarios.
2. **Given** ese mismo usuario con sesión activa, **When** intenta borrar a otro usuario, invitar a alguien, cambiar el rol de otro miembro o cambiar sus permisos, **Then** el sistema rechaza la acción con un mensaje de falta de permisos y no cambia nada.
3. **Given** ese mismo usuario, **When** abre la sección de usuarios, **Then** ve la lista de usuarios pero no ve las acciones de gestión.
4. **Given** una acción de gestión rechazada, **When** el owner revisa los eventos del SSO, **Then** encuentra el intento con quién lo hizo, la acción y el usuario afectado.

---

### User Story 2 - Los admins y el owner siguen gestionando usuarios como hoy (Priority: P1)

Una persona del grupo `admins` y el owner de la instancia siguen pudiendo invitar, borrar, cambiar roles y cambiar permisos con las mismas reglas que hoy aplica Dokploy (por ejemplo, solo el owner gestiona a otros admins).

**Why this priority**: La restricción no puede quitarle nada a quien sí debe gestionar usuarios; si lo hiciera, la instancia quedaría sin nadie capaz de dar de baja a una persona.

**Independent Test**: Un usuario del grupo `admins` borra a un miembro y cambia sus permisos con éxito; el owner cambia el rol de un admin con éxito.

**Acceptance Scenarios**:

1. **Given** un usuario que pertenece al grupo de gestión de usuarios, **When** entra por SSO y borra a un miembro, **Then** la acción funciona igual que antes de esta funcionalidad.
2. **Given** un usuario que pertenece a la vez a `admins` y a `leads`, **When** entra por SSO, **Then** puede gestionar usuarios, porque pertenece al grupo de gestión.
3. **Given** el owner de la instancia, **When** gestiona cualquier usuario, **Then** la acción funciona con independencia de sus grupos en el proveedor de identidad.

---

### User Story 3 - El owner activa la restricción sin romper instancias existentes (Priority: P2)

El owner configura qué grupo del proveedor de identidad puede gestionar usuarios, desde la pantalla de SSO o por variable de entorno, igual que el resto de ajustes del SSO. Mientras no lo configure, Dokploy se comporta exactamente como hoy.

**Why this priority**: Permite desplegar la versión nueva sin cambiar el comportamiento de ninguna instancia hasta que se decida activarlo, y a Milpia activarlo por entorno en lab y en prod.

**Independent Test**: Sin el grupo configurado, un admin de SSO que solo está en `leads` puede borrar a un miembro (comportamiento actual). Tras configurar `admins` y volver a iniciar sesión, ya no puede.

**Acceptance Scenarios**:

1. **Given** el grupo de gestión de usuarios sin configurar, **When** un admin gestiona usuarios, **Then** se aplican las reglas actuales de Dokploy sin cambios.
2. **Given** el grupo definido por variable de entorno, **When** el owner abre la pantalla de SSO, **Then** ve el valor bloqueado, como los demás ajustes que vienen del entorno.
3. **Given** el owner cambia el grupo de gestión, **When** un usuario ya con sesión abierta intenta gestionar usuarios, **Then** la decisión usa los grupos que el usuario tenía en su último login por SSO.

### Edge Cases

- Un lead sale del grupo `leads` y entra en `admins` en el proveedor de identidad: gana la gestión de usuarios en su siguiente login por SSO, no antes.
- Un admin del grupo `admins` pasa a estar solo en `leads`: pierde la gestión de usuarios en su siguiente login por SSO o, como mucho, 8 horas después de su último login por SSO (FR-015). El owner puede cerrar su sesión si es urgente.
- Un admin del grupo de gestión lleva más de 8 horas desde su último login por SSO: el sistema rechaza la acción de gestión y le indica que vuelva a iniciar sesión por SSO; el resto de su sesión sigue funcionando.
- Un admin que nunca entró por SSO (cuenta local) con el grupo de gestión configurado: no puede gestionar usuarios, porque no hay constancia de que pertenezca al grupo. El owner sí puede.
- Un lead intenta cambiarse su propio rol o sus propios permisos: se rechaza igual que para otros usuarios.
- Un lead gestiona sus propias sesiones (cerrar las suyas): sigue pudiendo, no es gestión de otros usuarios.
- El grupo de gestión de usuarios admite una lista separada por comas, igual que los grupos de acceso y de administración de la spec 001.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El owner MUST poder configurar un grupo de gestión de usuarios del proveedor de identidad, desde la pantalla de SSO o por variable de entorno, con la misma precedencia que el resto de ajustes del SSO (el valor del entorno manda y aparece bloqueado).
- **FR-002**: El grupo de gestión de usuarios MUST admitir una lista separada por comas; basta con pertenecer a uno de los grupos.
- **FR-003**: Cuando el grupo de gestión de usuarios está configurado, el sistema MUST permitir gestionar usuarios solo al owner y a los admins cuyo último login por SSO mostró que pertenecen a ese grupo. El grupo funciona como lista de permitidos: si falta la información de grupos o el grupo no coincide, el sistema MUST negar la gestión.
- **FR-004**: Gestionar usuarios comprende: borrar un usuario o quitarlo de la organización, invitar a un usuario, crear un usuario con credenciales, reenviar o cancelar una invitación, cambiar el rol de un miembro, cambiar los permisos de un miembro y crear, modificar o borrar definiciones de roles. La restricción MUST cubrir todas las vías por las que el servidor permite esas acciones, no solo las que usa la interfaz.
- **FR-005**: Un admin sin permiso de gestión de usuarios MUST conservar el resto de capacidades del rol admin.
- **FR-006**: El sistema MUST rechazar en el servidor toda acción de gestión de usuarios de quien no tiene el permiso, aunque la petición no venga de la interfaz, con un error de falta de permisos y sin cambiar nada.
- **FR-007**: La interfaz MUST ocultar las acciones de gestión de usuarios a quien no tiene el permiso, sin ocultarle la lista de usuarios. Si el admin pertenece al grupo de gestión pero su permiso caducó (FR-015), la sección de usuarios MUST mostrarle un aviso que le indique que vuelva a iniciar sesión por SSO para recuperarlo.
- **FR-008**: El sistema MUST recalcular la pertenencia al grupo de gestión de usuarios en cada login por SSO, igual que el rol (spec 001, FR-008a).
- **FR-009**: Sin grupo de gestión de usuarios configurado, el sistema MUST mantener las reglas actuales de Dokploy sin ningún cambio.
- **FR-010**: El owner MUST poder gestionar usuarios siempre, con independencia de sus grupos.
- **FR-011**: Las reglas actuales de Dokploy entre roles MUST seguir aplicándose además de esta: solo el owner gestiona a otros admins y nadie cambia su propio rol.
- **FR-012**: El sistema MUST registrar en los eventos del SSO (los que el owner ya consulta en la pantalla de SSO) cada intento rechazado de gestión de usuarios, con quién lo intentó, la acción y el usuario afectado.
- **FR-013**: La funcionalidad MUST NOT depender de roles personalizados ni de ningún código bajo licencia enterprise.
- **FR-014**: Cuando el grupo de gestión de usuarios está configurado, un admin que nunca ha entrado por SSO MUST NOT poder gestionar usuarios hasta que un login por SSO confirme que pertenece al grupo. El owner queda exento (FR-010).
- **FR-015**: El permiso de gestión de usuarios de un admin MUST caducar 8 horas después de su último login por SSO. Pasado ese plazo, el sistema MUST rechazar las acciones de gestión con un mensaje que pida volver a iniciar sesión por SSO, sin cerrar la sesión ni afectar al resto de capacidades. El owner queda exento (FR-010).

### Key Entities

- **Grupo de gestión de usuarios**: ajuste nuevo de la configuración del SSO, con el mismo formato que los grupos de acceso y de administración.
- **Constancia de grupos de un miembro**: los grupos que el proveedor de identidad informó en el último login por SSO del admin y el momento de ese login. Cada acción de gestión la contrasta con el grupo de gestión configurado y con la caducidad de 8 horas.

### Non-Functional Requirements

- **NFR-PERF-001**: Con el grupo de gestión de usuarios sin configurar o el SSO inactivo, la funcionalidad MUST NOT añadir consultas ni más de 1 ms (p95) a ninguna petición.
- **NFR-PERF-002**: Con el grupo configurado, la comprobación MUST añadir como máximo 20 ms (p95) a cada acción de gestión de usuarios y MUST NOT añadir consultas al resto de peticiones.
- **NFR-SEC-001**: Cualquier error al comprobar el permiso (configuración ilegible, fallo de base de datos, sesión sin organización) MUST resolverse denegando la acción de gestión.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de las acciones de gestión de usuarios (borrar, invitar, cancelar invitación, cambiar rol, cambiar permisos) intentadas por un lead se rechazan, tanto desde la interfaz como por llamada directa.
- **SC-002**: Un lead completa las tareas habituales de admin (crear un proyecto, desplegar un servicio, revisar contenedores) sin ningún rechazo.
- **SC-003**: Los admins del grupo de gestión y el owner completan el 100 % de las acciones de gestión que hoy pueden hacer.
- **SC-004**: Una instancia que actualiza sin configurar el grupo no cambia de comportamiento: las pruebas actuales de gestión de usuarios pasan sin modificarse.
- **SC-005**: Un cambio de grupo en el proveedor de identidad se refleja en el permiso de gestión en el siguiente login del usuario y, como mucho, 8 horas después de su último login por SSO.

## Assumptions

- En Milpia, con SSO-only en prod, todos los usuarios salvo el owner entran por SSO, así que la regla para admins locales (FR-014) solo tiene efecto en modo botón.
- Cerrar sesiones de otros usuarios queda fuera de alcance: Dokploy ya lo reserva al owner.
- Cambiar la configuración no cierra sesiones abiertas: la decisión usa los grupos del último login por SSO contra la configuración vigente, dentro de la caducidad de 8 horas.
- Milpia configurará `admins` como grupo de gestión de usuarios, manteniendo `SSO_OIDC_ADMIN_GROUP=admins,leads` de la spec 014 de infra.
- Depende de la spec 001 (SSO por OIDC) ya integrada en `canary`.
