# Feature Specification: SSO por OpenID Connect para la edición free (Keycloak, Okta, Authentik, Zitadel, Authelia)

> **Alcance ampliado (sesión 2026-09-25, tarde):** la funcionalidad es un SSO por OpenID Connect genérico,
> con Keycloak como proveedor principal y de referencia. Donde este documento dice «Keycloak» debe leerse
> «el proveedor OIDC configurado» (Keycloak, Okta, Authentik, Zitadel, Authelia u otro compatible), salvo
> en los requisitos FR-022 a FR-025, que tratan las diferencias entre proveedores.

**Feature Branch**: `001-keycloak-sso`

**Created**: 2026-09-25

**Status**: Implemented (pendiente de revisión)

**Input**: User description: "SSO con Keycloak para la edición free (self-hosted) de Dokploy. La instancia free debe poder conectarse a un servidor Keycloak (OIDC) y usarlo como proveedor de identidad. Dos modos, ambos casos especiales configurables: (1) Modo SSO-only: al entrar, el usuario es redirigido directamente a Keycloak y tras autenticarse aterriza en el panel, sin ver la pantalla de login local. (2) Modo botón: la pantalla de login normal muestra un botón «Iniciar sesión con Keycloak» que redirige a Keycloak y al volver lleva al panel."

## Clarifications

### Session 2026-09-25

- Q: Cuando alguien inicia sesión con Keycloak y todavía no tiene cuenta en Dokploy, ¿qué debe pasar? → A: Se crea la cuenta automáticamente solo si pertenece a un grupo de Keycloak configurable (p. ej. `dokploy-users`); si no, se rechaza.
- Q: ¿Qué rol recibe en Dokploy un usuario al que el SSO le crea la cuenta? → A: Según grupos de Keycloak, actualizado en cada login: el grupo de administración (p. ej. `dokploy-admins`, que agrupa a admins y leads) → admin; el resto → member.
- Q: Si la instancia está en modo SSO-only y Keycloak se cae, ¿cómo recupera el owner el acceso al panel? → A: Ambas vías: una ruta web de emergencia que solo acepta la contraseña local del owner, y un comando en el servidor que desactiva SSO-only.
- Q: ¿Desde dónde se configura la conexión con Keycloak: desde la interfaz del owner, desde variables de entorno o desde las dos? → A: Ambas; cada valor definido por variable de entorno manda y aparece bloqueado en la interfaz.
- Q: Si se elimina a un usuario en Dokploy pero sigue en el grupo de acceso de Keycloak, ¿qué pasa cuando vuelve a iniciar sesión? → A: Keycloak es la fuente de verdad: se vuelve a crear su cuenta. Para quitarle el acceso hay que sacarlo del grupo o banearlo en Dokploy. *(Decisión autónoma durante la implementación nocturna; pendiente de revisión.)*
- Q: Cuando hay grupo de acceso configurado, ¿los usuarios que ya existían en Dokploy (no owner) también deben pertenecer a él para entrar por SSO? → A: Sí; el grupo de acceso se exige a todos salvo al owner. *(Decisión autónoma; pendiente de revisión.)*
- Q: En modo SSO-only, ¿cómo se incorpora a una persona nueva si el registro local está cerrado? → A: Se añade al grupo de acceso en Keycloak; las invitaciones de Dokploy quedan desactivadas en SSO-only y siguen funcionando en modo botón. *(Decisión autónoma; pendiente de revisión.)*
- Q: ¿Debe el SSO limitarse a Keycloak? → A: No. Debe funcionar principalmente con Keycloak, pero también con Okta, Authentik, Zitadel y Authelia (cualquier proveedor OIDC estándar).
- Q: ¿Cómo se nombra la funcionalidad ahora que no es solo Keycloak? → A: De forma genérica: «Single sign-on (OIDC)» en la interfaz, variables `SSO_OIDC_*` y nombres internos `oidc-sso`; Keycloak es el preset por defecto.
- Q: En modo SSO-only no se exigen cambios para los endpoints SAML del SSO enterprise ni para las API keys, que siguen funcionando. → A: Se mantienen así a propósito.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Iniciar sesión con el botón de Keycloak (Priority: P1)

Un miembro del equipo abre la instancia de Dokploy y ve la pantalla de login de siempre, con un botón adicional «Iniciar sesión con Keycloak». Al pulsarlo lo lleva a la página de login de Keycloak de la organización; tras autenticarse allí vuelve a Dokploy y aterriza directamente en el panel, sin haber escrito una contraseña de Dokploy.

**Why this priority**: Es el modo menos invasivo: añade SSO sin quitar el login local, así que no hay riesgo de dejar a nadie fuera. Por sí solo ya entrega el valor principal (una identidad central para todo el equipo) y es la base sobre la que se construye el modo SSO-only.

**Independent Test**: Con Keycloak configurado en modo botón, un usuario pulsa el botón, se autentica en Keycloak y termina en el panel de Dokploy con su sesión activa. El login con email y contraseña sigue funcionando en paralelo.

**Acceptance Scenarios**:

1. **Given** una instancia con Keycloak configurado en modo botón, **When** un visitante abre la pantalla de login, **Then** ve el formulario local y además el botón «Iniciar sesión con Keycloak».
2. **Given** la pantalla de login en modo botón, **When** el usuario pulsa el botón y se autentica correctamente en Keycloak, **Then** vuelve a Dokploy con una sesión iniciada y ve el panel.
3. **Given** un usuario que ya existe en Dokploy con el mismo email verificado que en Keycloak, **When** inicia sesión por Keycloak por primera vez, **Then** entra con su cuenta existente, con sus permisos intactos, y no se crea una cuenta duplicada.
4. **Given** el modo botón activo, **When** un usuario inicia sesión con email y contraseña, **Then** el login local funciona igual que antes de la funcionalidad.
5. **Given** un usuario que cancela o falla la autenticación en Keycloak, **When** vuelve a Dokploy, **Then** ve la pantalla de login con un mensaje de error comprensible y puede reintentar.

---

### User Story 2 - Acceso directo al panel en modo SSO-only (Priority: P2)

En una instancia configurada en modo SSO-only, un usuario escribe la URL de Dokploy y no ve ninguna pantalla de login de Dokploy: es redirigido automáticamente a Keycloak y, tras autenticarse (o de inmediato si ya tenía sesión en Keycloak), aterriza en el panel.

**Why this priority**: Es el modo que pide una organización que quiere que Keycloak sea la única puerta de entrada. Depende de la misma conexión con Keycloak que la Story 1, pero añade el riesgo de bloqueo, por eso va segunda.

**Independent Test**: Con Keycloak configurado en modo SSO-only, abrir la URL raíz de Dokploy en un navegador sin sesión lleva a Keycloak; tras autenticarse, el usuario ve el panel sin haber visto el formulario local.

**Acceptance Scenarios**:

1. **Given** una instancia en modo SSO-only y un navegador sin sesión en Dokploy, **When** el usuario abre cualquier URL de Dokploy, **Then** es redirigido a Keycloak sin ver el formulario de login local.
2. **Given** un usuario con sesión activa en Keycloak, **When** abre Dokploy en modo SSO-only, **Then** llega al panel sin introducir credenciales.
3. **Given** un usuario que abrió un enlace profundo (p. ej. un proyecto concreto), **When** completa el login en Keycloak, **Then** aterriza en esa página y no en la portada del panel.
4. **Given** el modo SSO-only activo, **When** alguien intenta iniciar sesión con email y contraseña por la vía normal, **Then** el intento se rechaza.
5. **Given** el modo SSO-only activo, **When** el usuario cierra sesión en Dokploy, **Then** también se cierra su sesión en Keycloak, para que no vuelva a entrar automáticamente en el mismo instante.

---

### User Story 3 - Configurar la conexión con Keycloak y elegir el modo (Priority: P1)

El owner de la instancia registra los datos de su servidor Keycloak (la URL del realm, el identificador del cliente y su secreto) y elige uno de tres modos: desactivado, botón o SSO-only. Antes de activar SSO-only puede comprobar que la conexión funciona.

**Why this priority**: Sin configuración no existe ninguna de las otras dos stories; comparte P1 con la Story 1 porque juntas forman el MVP.

**Independent Test**: El owner introduce una configuración válida, pulsa «Probar conexión» y ve un resultado positivo; con datos erróneos ve el motivo concreto del fallo.

**Acceptance Scenarios**:

1. **Given** una instancia sin SSO y sin variables de entorno de SSO, **When** el owner guarda una configuración de Keycloak válida en modo botón, **Then** el botón aparece en la pantalla de login sin reiniciar la instancia.
2. **Given** una configuración con la URL del realm inaccesible o el secreto incorrecto, **When** el owner prueba la conexión, **Then** ve un mensaje que indica qué dato falla.
3. **Given** que nadie ha iniciado sesión con Keycloak todavía, **When** el owner intenta activar el modo SSO-only, **Then** el sistema le exige haber completado antes un login de prueba por Keycloak con su propia cuenta.
4. **Given** la URL del realm y el secreto definidos por variables de entorno, **When** el owner abre la configuración de SSO, **Then** ve esos valores bloqueados con su origen indicado y puede editar el resto.
5. **Given** el modo SSO-only activo, **When** el owner vuelve a poner el modo en desactivado, **Then** la pantalla de login local vuelve a mostrarse de inmediato.

---

### User Story 4 - Recuperar el acceso si Keycloak no está disponible (Priority: P2)

Keycloak se cae o su configuración se rompe mientras la instancia está en modo SSO-only. El owner necesita una vía de emergencia documentada para entrar con su cuenta local y corregir la configuración o desactivar SSO-only.

**Why this priority**: Un modo SSO-only sin vía de recuperación puede dejar la instancia inaccesible para siempre. No es el camino feliz, pero es condición para que el modo SSO-only se pueda usar con seguridad.

**Independent Test**: Con SSO-only activo y Keycloak apagado, el owner usa la ruta web de emergencia, inicia sesión con su contraseña local y desactiva SSO-only. Por separado, ejecutar el comando en el servidor deja la instancia en modo botón.

**Acceptance Scenarios**:

1. **Given** el modo SSO-only activo y Keycloak inaccesible, **When** un usuario abre Dokploy, **Then** ve una página de error clara en lugar de un bucle de redirecciones.
2. **Given** el modo SSO-only activo, **When** el owner usa la vía de emergencia, **Then** puede iniciar sesión con su email y contraseña local.
3. **Given** el modo SSO-only activo, **When** un usuario que no es owner intenta usar la vía de emergencia, **Then** el acceso se rechaza.
4. **Given** el modo SSO-only activo y el owner sin su contraseña local, **When** un operador con acceso al servidor ejecuta el comando de emergencia, **Then** la instancia pasa a modo botón y el formulario local vuelve a mostrarse.
5. **Given** cualquier uso de la vía de emergencia, **When** se completa o se rechaza, **Then** queda registrado quién la usó y cuándo.

---

### Edge Cases

- El email que devuelve Keycloak no está verificado: no se vincula con ninguna cuenta existente y el login se rechaza con un mensaje explicativo.
- Keycloak no devuelve email: el login se rechaza, porque el email es la clave para vincular la cuenta.
- Un usuario sin cuenta en Dokploy que no pertenece al grupo de acceso se autentica en Keycloak: se rechaza el login y no se crea ninguna cuenta.
- Un admin sale del grupo de administración en Keycloak: en su siguiente login pasa a member. Las sesiones abiertas conservan el rol anterior hasta que caducan.
- Un usuario creado por SSO sale después del grupo de acceso en Keycloak: pierde el acceso por SSO en su siguiente login.
- Un usuario que ya existe en Dokploy se da de baja o se deshabilita en Keycloak: deja de poder entrar por SSO en su próximo login. Las sesiones de Dokploy que ya estuvieran abiertas duran hasta que caduquen.
- Un usuario baneado en Dokploy se autentica en Keycloak: no obtiene acceso.
- Un usuario eliminado en Dokploy que sigue en el grupo de acceso se autentica en Keycloak: se vuelve a crear su cuenta con el rol que le correspondan sus grupos. Para revocar el acceso hay que sacarlo del grupo o banearlo.
- Un usuario que ya existía en Dokploy (no owner) y no pertenece al grupo de acceso configurado intenta entrar por SSO: se rechaza.
- En modo SSO-only, alguien abre un enlace de invitación de Dokploy: ve un mensaje que le indica que pida acceso al grupo de Keycloak; no se puede crear una cuenta local.
- El reloj de la instancia está desincronizado con Keycloak y la respuesta llega como caducada: se muestra un error comprensible en vez de un fallo genérico.
- La instancia se sirve por una URL distinta de la registrada en Keycloak como URL de retorno: la prueba de conexión o el primer login indican el desajuste.
- El modo SSO-only viene de una variable de entorno y Keycloak está caído: la ruta web de emergencia sigue funcionando para el owner, pero el comando de emergencia avisa de que el modo solo se desactiva cambiando la variable.
- Se cambia la configuración mientras hay usuarios con sesión iniciada: sus sesiones actuales no se invalidan y la nueva configuración se aplica en el siguiente login.
- La instancia tiene una licencia enterprise y además el SSO propietario configurado: esta funcionalidad no debe interferir con él (ver Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST permitir registrar una conexión con un servidor Keycloak mediante OIDC, indicando la URL del realm, el identificador del cliente y su secreto.
- **FR-002**: El sistema MUST ofrecer tres modos de SSO excluyentes: desactivado (por defecto), botón y SSO-only.
- **FR-003**: En modo botón, la pantalla de login MUST mostrar el formulario local y un botón «Iniciar sesión con Keycloak», cuyo texto el owner puede personalizar.
- **FR-004**: En modo SSO-only, cualquier visita sin sesión MUST redirigir automáticamente a Keycloak sin mostrar el formulario de login local.
- **FR-005**: Tras un login correcto en Keycloak, el sistema MUST crear una sesión de Dokploy y llevar al usuario a la página que pidió originalmente, o al panel si entró por la raíz.
- **FR-006**: El sistema MUST vincular un login de Keycloak con la cuenta existente de Dokploy que tenga el mismo email, solo si Keycloak marca ese email como verificado.
- **FR-007**: Cuando llega un usuario de Keycloak sin cuenta en Dokploy, el sistema MUST crearle la cuenta automáticamente solo si pertenece al grupo de acceso configurado en Keycloak; si no pertenece, MUST rechazar el login con un mensaje que indique que no tiene acceso a esta instancia.
- **FR-007a**: El owner MUST poder configurar el nombre del grupo de acceso de Keycloak. Sin grupo configurado, el sistema MUST NOT crear cuentas nuevas por SSO (solo se vinculan cuentas existentes según FR-006).
- **FR-007b**: Cuando hay grupo de acceso configurado, el sistema MUST exigir pertenecer a él a todo usuario que entre por SSO, sea nuevo o existente, salvo al owner.
- **FR-008**: Cuando hay grupo de administración configurado, el sistema MUST asignar el rol de Dokploy según los grupos de Keycloak del usuario: los miembros del grupo de administración (p. ej. `dokploy-admins`, que en la organización incluye a admins y leads) reciben el rol admin; el resto, el rol member. Sin grupo de administración configurado, los usuarios nuevos reciben member y los existentes conservan su rol.
- **FR-008a**: El sistema MUST recalcular el rol en cada login por SSO, de modo que añadir o quitar a alguien del grupo de administración en Keycloak se refleje en su siguiente login.
- **FR-008b**: El rol owner MUST NOT asignarse ni retirarse por SSO: el owner conserva su rol aunque no esté en el grupo de administración, y nadie obtiene el rol owner a través de Keycloak.
- **FR-008c**: El owner MUST poder configurar el nombre del grupo de administración. Los cambios manuales de rol en Dokploy sobre usuarios de SSO se sobrescriben en su siguiente login; la interfaz MUST advertirlo.
- **FR-009**: En modo SSO-only, el sistema MUST rechazar el login con email y contraseña, el registro de nuevas cuentas (incluida la aceptación de invitaciones) y el restablecimiento de contraseña, salvo por la ruta web de emergencia de FR-012.
- **FR-010**: En modo SSO-only, cerrar sesión en Dokploy MUST cerrar también la sesión en Keycloak. En modo botón, cerrar sesión solo cierra la sesión de Dokploy.
- **FR-011**: El sistema MUST impedir activar SSO-only hasta que el owner que lo activa haya completado al menos un login correcto por Keycloak con su propia cuenta.
- **FR-012**: El sistema MUST ofrecer una ruta web de emergencia, documentada, que permita solo al owner iniciar sesión con su email y contraseña local cuando el modo SSO-only está activo. Cualquier otra cuenta MUST ser rechazada en esa ruta.
- **FR-012a**: El sistema MUST ofrecer un comando que se ejecuta en el servidor de la instancia (requiere acceso al host o al contenedor) y que desactiva el modo SSO-only, dejando la instancia en modo botón.
- **FR-013**: El sistema MUST dejar registrados los logins por SSO fallidos y cada uso, correcto o rechazado, de la vía de emergencia, con la hora y la identidad implicada.
- **FR-014**: El owner MUST poder comprobar la conexión con Keycloak antes de guardarla y recibir un motivo concreto cuando falla.
- **FR-015**: El secreto del cliente MUST guardarse protegido, no mostrarse nunca completo tras guardarlo y no aparecer en logs.
- **FR-016**: Cuando Keycloak no está disponible, el sistema MUST mostrar una página de error con un enlace para reintentar y MUST NOT entrar en un bucle de redirecciones.
- **FR-017**: Esta funcionalidad MUST estar disponible sin licencia enterprise y MUST implementarse de forma independiente del código bajo directorios `/proprietary` del repositorio.
- **FR-018**: Los cambios de configuración de SSO hechos desde la interfaz MUST aplicarse sin reiniciar la instancia.
- **FR-019**: Cada valor de la configuración de SSO (URL del realm, cliente, secreto, grupos, modo y texto del botón) MUST poder definirse también mediante variables de entorno. Un valor definido así MUST prevalecer sobre el guardado desde la interfaz.
- **FR-020**: La interfaz MUST mostrar como bloqueados, e indicar su origen, los valores que vienen de variables de entorno. Los demás valores MUST seguir siendo editables.
- **FR-021**: El comando de emergencia de FR-012a MUST advertir si el modo SSO-only viene de una variable de entorno, porque en ese caso solo se desactiva cambiando la variable y reiniciando.
- **FR-022**: El sistema MUST funcionar con cualquier proveedor OpenID Connect que publique un documento de discovery y emita ID tokens firmados, y MUST verificarse al menos con Keycloak, Okta, Authentik, Zitadel y Authelia.
- **FR-023**: El nombre del claim que contiene los grupos o roles MUST ser configurable (por defecto `groups`). El sistema MUST aceptar ese claim como lista de textos, como texto único o como objeto cuyas claves son los nombres (formato de roles de Zitadel, `urn:zitadel:iam:org:project:roles`).
- **FR-024**: La configuración MUST ofrecer presets para Keycloak, Okta, Authentik, Zitadel, Authelia y «Otro (OIDC genérico)», que rellenan el claim de grupos y muestran el formato de la URL del issuer de cada proveedor. Los presets solo ayudan a rellenar: no limitan la configuración.
- **FR-025**: En modo SSO-only, si el proveedor no ofrece cierre de sesión (`end_session_endpoint`, p. ej. Authelia), cerrar sesión MUST llevar a una pantalla de «sesión cerrada» que no redirige automáticamente al proveedor, para que el usuario no vuelva a entrar sin querer.

### Non-Functional Requirements

**Seguridad**

- **NFR-SEC-001**: El flujo de login MUST seguir las buenas prácticas vigentes de seguridad para OAuth 2.0 y OpenID Connect (OAuth 2.0 Security Best Current Practice, RFC 9700): flujo de código de autorización con PKCE, y parámetros `state` y `nonce` de un solo uso ligados a la sesión del navegador que inició el login.
- **NFR-SEC-002**: Toda respuesta de identidad de Keycloak MUST validarse antes de conceder acceso: firma, emisor, destinatario, caducidad, fecha de emisión y `nonce`. Si falla cualquiera de estas validaciones, se deniega el acceso.
- **NFR-SEC-003**: La redirección posterior al login (FR-005) MUST aceptar solo rutas internas de la propia instancia; cualquier otro destino MUST sustituirse por el panel, para impedir redirecciones abiertas.
- **NFR-SEC-004**: Toda comunicación con Keycloak MUST hacerse por HTTPS con verificación de certificado. Solo se permite HTTP sin cifrar si el owner lo activa de forma explícita para entornos de desarrollo, y la interfaz MUST mostrar una advertencia visible mientras esté activo.
- **NFR-SEC-005**: Tras un login por SSO, el sistema MUST emitir una sesión nueva (sin reutilizar identificadores de sesión previos) cuya cookie siga exactamente la política de cookies de sesión de Dokploy (`HttpOnly`, `SameSite=Lax`; `Secure` según la configuración existente de la instancia). La cookie temporal del login MUST ser `HttpOnly`, `SameSite=Lax`, firmada, de 10 minutos como máximo, y `Secure` cuando la petición llega por HTTPS.
- **NFR-SEC-006**: La ruta web de emergencia y los endpoints de retorno del login MUST limitar los intentos repetidos por origen, y los mensajes de error MUST NOT revelar si una cuenta existe.
- **NFR-SEC-007**: Los tokens de Keycloak MUST NOT guardarse en el navegador ni en logs. Solo se conserva lo imprescindible para cerrar la sesión en Keycloak (FR-010).
- **NFR-SEC-008**: Los controles de seguridad de la funcionalidad MUST cumplir los requisitos de autenticación y gestión de sesión de OWASP ASVS nivel 2 que le apliquen, y el plan MUST incluir su lista de comprobación.
- **NFR-SEC-009**: Antes del merge, la funcionalidad MUST pasar un análisis de dependencias sin vulnerabilidades altas o críticas conocidas y una revisión de seguridad del código.

**Rendimiento**

- **NFR-PERF-001**: Con el modo desactivado, la funcionalidad MUST NOT añadir más de 5 ms (p95) al tiempo de respuesta de ninguna página ni llamada al servidor, ni ninguna petición de red a Keycloak.
- **NFR-PERF-002**: El trabajo que hace Dokploy en un login por SSO, excluido el tiempo propio de Keycloak y del usuario, MUST completarse en menos de 300 ms (p95).
- **NFR-PERF-003**: Los metadatos del proveedor y sus claves de firma MUST reutilizarse entre logins y refrescarse solo cuando caduquen o cuando llegue una firma con una clave desconocida, en lugar de descargarse en cada login.
- **NFR-PERF-004**: Toda llamada a Keycloak MUST tener un tiempo máximo de espera de 5 segundos. Al superarlo, se aplica FR-016 en lugar de dejar al usuario esperando.
- **NFR-PERF-005**: La configuración de SSO MUST leerse sin consultar la base de datos en cada petición, y los cambios hechos desde la interfaz MUST aplicarse en un máximo de 5 segundos (FR-018).
- **NFR-PERF-006**: El sistema MUST soportar 50 logins por SSO simultáneos sin errores y sin superar el objetivo de NFR-PERF-002.

**Calidad**

- **NFR-QA-001**: La lógica nueva de la funcionalidad MUST tener al menos un 90 % de cobertura de líneas y un 85 % de cobertura de ramas en pruebas automáticas, y el 100 % de las decisiones de acceso (conceder, denegar, vincular, asignar rol) MUST estar cubiertas.
- **NFR-QA-002**: Cada escenario de aceptación de las user stories MUST tener una prueba automática de extremo a extremo contra una instancia de Keycloak efímera.
- **NFR-QA-003**: El código MUST pasar lint, formato y comprobación de tipos del repositorio sin errores ni supresiones nuevas.
- **NFR-QA-004**: Los mensajes al usuario MUST ser comprensibles y accionables, y los errores técnicos MUST registrarse con un identificador de correlación que el usuario pueda aportar a soporte.
- **NFR-QA-005**: La funcionalidad MUST documentar la configuración de Keycloak (cliente, URL de retorno, grupos), las variables de entorno y los dos procedimientos de emergencia.

### Key Entities *(include if feature involves data)*

- **Configuración de Keycloak**: una por instancia. Contiene la URL del realm, el identificador del cliente, el secreto (protegido), el grupo de acceso, el grupo de administración, el nombre del claim de grupos, el modo (desactivado, botón o SSO-only), el texto del botón y la marca de «login de prueba completado».
- **Vínculo de identidad**: relaciona una cuenta de Dokploy con su identidad en Keycloak (identificador estable del usuario en el realm), para reconocerlo aunque cambie de email en Keycloak.
- **Evento de autenticación**: el registro de un login por SSO fallido o de un uso de la vía de emergencia, con la hora, el usuario y el resultado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un usuario con sesión ya activa en Keycloak llega al panel de Dokploy en modo SSO-only en menos de 5 segundos desde que abre la URL, sin escribir credenciales.
- **SC-002**: Un owner configura la conexión con Keycloak y deja funcionando el modo botón en menos de 10 minutos, usando solo la interfaz y la documentación.
- **SC-003**: El 100 % de los usuarios existentes con email verificado conservan sus permisos en su primer login por Keycloak, sin cuentas duplicadas.
- **SC-004**: Con Keycloak apagado, el owner recupera el acceso a una instancia en modo SSO-only en menos de 5 minutos usando la vía de emergencia documentada.
- **SC-005**: Con SSO-only activo, ningún intento de login con contraseña local fuera de la vía de emergencia tiene éxito.
- **SC-006**: Con el modo desactivado, la pantalla y el flujo de login son idénticos a los de la versión anterior a esta funcionalidad.
- **SC-007**: Una revisión de seguridad independiente no encuentra hallazgos de severidad alta o crítica, y las pruebas de ataques conocidos (reutilización de respuestas, `state` manipulado, token de otro cliente, redirección a dominio externo) son rechazadas en el 100 % de los casos.
- **SC-008**: En una prueba de carga con 50 logins simultáneos, el 95 % de los usuarios llega al panel sin errores y sin que el tiempo atribuible a Dokploy supere los 300 ms.
- **SC-009**: Con el modo desactivado, las mediciones de rendimiento del login y del panel no empeoran más de un 2 % respecto a la versión anterior.

## Assumptions

- «Edición free» es la instalación self-hosted de Dokploy sin licencia enterprise. La edición cloud queda fuera del alcance.
- Dokploy ya incluye SSO (OIDC y SAML) en su código propietario, bajo `/proprietary`, protegido por licencia enterprise y bajo la licencia DSAL, que no permite usarlo en producción sin un acuerdo comercial. Esta funcionalidad no reutiliza, copia ni desbloquea ese código: es una implementación independiente fuera de `/proprietary`. Si una instancia tiene licencia enterprise, su SSO propietario prevalece y esta funcionalidad se desactiva.
- Se soporta un solo servidor Keycloak por instancia y una sola organización. No se contemplan varios proveedores a la vez.
- Se da por hecho que el cliente de Keycloak es confidencial (con secreto) y que el administrador de Keycloak registra la URL de retorno que muestre Dokploy.
- Los cambios en variables de entorno requieren reiniciar la instancia para aplicarse; es la forma habitual de configurar un despliegue automatizado (p. ej. con los secretos inyectados desde Vault).
- La ruta web de emergencia usa la protección contra intentos repetidos que ya tenga el login local; esta funcionalidad no añade una propia.
- Los eventos de autenticación se conservan 90 días.
- Terminología: «ruta web de emergencia» es la página de login local solo para el owner; «comando de emergencia» es el comando que se ejecuta en el servidor. Ambos forman la «vía de emergencia».
- La duración de la sesión de Dokploy sigue la configuración de sesión que ya existe. No se sincroniza con la duración de la sesión de Keycloak.
- La funcionalidad se basa solo en OIDC estándar (discovery, authorization code con PKCE, ID token, userinfo, RP-initiated logout). Las diferencias entre proveedores se cubren con configuración (FR-023, FR-024), no con código específico de cada uno.
- La verificación de email se mantiene estricta con todos los proveedores: los cinco soportados envían `email_verified`.
