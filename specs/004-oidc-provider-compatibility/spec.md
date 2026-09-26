# Feature Specification: Compatibilidad verificada con siete proveedores OIDC

**Feature Branch**: `004-oidc-provider-compatibility`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: "Extiende la spec 001 (SSO por OpenID Connect, módulo oidc-sso, ya en canary) sin reabrirla: el módulo es un cliente OIDC (relying party), no un IAM ni un PAM, y debe quedar VERIFICADO con siete proveedores: Keycloak, Okta, Auth0, Authentik, Zitadel, FusionAuth y Authelia. Hoy solo Keycloak tiene e2e real (9 escenarios contra Keycloak 26); Okta, Authentik, Zitadel y Authelia están en FR-022 de la 001 con guía y pruebas unitarias, y Auth0 y FusionAuth no están contemplados. Para cada proveedor se necesita: guía de configuración, cualquier ajuste del módulo que haga falta por sus diferencias, y una prueba e2e que ejercite el flujo real: login, provisioning por grupo de acceso, rol admin por grupo de administración, denegación fuera del grupo, cierre de sesión, conexión de prueba con secreto correcto e incorrecto. Los autoalojables se prueban con instancias efímeras en Docker; Okta y Auth0, que solo existen como SaaS, con tenants de desarrollo creados solo para pruebas, credenciales en variables de entorno (nunca en el repo) y ejecución opt-in: sin credenciales la prueba se omite y lo informa. Debe quedar una matriz de compatibilidad documentada y mantenida."

## Clarifications

### Session 2026-09-26

- Q: ¿Esto se documenta en la spec 001 o en una nueva? → A: En una spec nueva (004), que extiende la 001 sin reabrirla. La 001 conserva su alcance y apunta a esta.
- Q: ¿Cómo se verifican Okta y Auth0, que solo existen como SaaS? → A: Con tenants de desarrollo creados solo para pruebas, con credenciales en variables de entorno y ejecución opt-in. Sin credenciales, la prueba se omite e informa de ello.
- Q: ¿Las verificaciones de los cinco proveedores autoalojables deben ejecutarse también en CI, o solo a mano? → A: Workflow de GitHub Actions para los 5 autoalojables, lanzable a mano y semanal. Okta y Auth0, solo en local.
- Q: ¿La matriz de compatibilidad se actualiza a mano o se genera a partir de los resultados de las verificaciones? → A: Generada: cada verificación guarda sus resultados y un comando rehace la tabla. Las limitaciones se escriben a mano.
- Q: ¿La verificación de cada proveedor debe comprobar también las funciones de las specs 002 y 003? → A: Sí para la 002 (un escenario por proveedor para el grupo de gestión de usuarios, en cuanto esa spec esté implementada). La 003 no, porque no depende del proveedor.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El owner conecta Dokploy a su proveedor, sea cual sea de los siete (Priority: P1)

El owner de una instancia usa Keycloak, Okta, Auth0, Authentik, Zitadel, FusionAuth o Authelia. Abre la guía de operación, busca la sección de su proveedor, crea el cliente siguiendo los pasos, elige el preset en la pantalla de SSO, comprueba la conexión y el equipo empieza a entrar con su cuenta de siempre, con el rol que le corresponde según sus grupos.

**Why this priority**: es la promesa del módulo. Hoy solo está demostrada con Keycloak. Con los demás, el owner puede encontrarse que los grupos no llegan o que el cierre de sesión no funciona, y descubrirlo en producción.

**Independent Test**: para cada proveedor, un operador sin conocimiento previo del módulo sigue solo la guía y consigue que un usuario del grupo de acceso entre, que un usuario del grupo de administración reciba el rol admin y que uno ajeno al grupo sea rechazado.

**Acceptance Scenarios**:

1. **Given** una instancia del proveedor configurada según su guía, **When** un usuario del grupo de acceso inicia sesión por primera vez, **Then** entra al panel y se le crea la cuenta con el rol member.
2. **Given** lo mismo, **When** entra un usuario del grupo de administración, **Then** recibe el rol admin.
3. **Given** lo mismo, **When** intenta entrar un usuario que no está en el grupo de acceso, **Then** se le rechaza con el mensaje de falta de acceso y queda registrado.
4. **Given** un usuario ya creado, **When** se le cambia de grupo en el proveedor y vuelve a iniciar sesión, **Then** su rol en Dokploy refleja el cambio.
5. **Given** el modo SSO-only, **When** el usuario cierra sesión, **Then** se cierra también su sesión en el proveedor o, si el proveedor no lo permite, llega a la pantalla de «sesión cerrada» sin volver a entrar solo.
6. **Given** la pantalla de SSO, **When** el owner prueba la conexión con el secreto correcto, **Then** recibe «conexión correcta»; **And When** la prueba con un secreto incorrecto, **Then** recibe un error de credenciales, nunca «conexión correcta».

---

### User Story 2 - El equipo sabe con certeza qué está verificado y con qué versión (Priority: P1)

Quien mantiene el fork abre la matriz de compatibilidad y ve, por proveedor, la versión probada, la fecha de la última verificación y el resultado de cada función: login, grupos, roles, denegación, cierre de sesión, fin de sesión en el proveedor y prueba de conexión, junto con las limitaciones conocidas. Puede repetir la verificación de cualquier proveedor con un solo comando.

**Why this priority**: sin una matriz y unas pruebas repetibles, «compatible» es una afirmación que nadie puede comprobar, y una actualización del proveedor o de Dokploy puede romper la compatibilidad sin que nadie se entere.

**Independent Test**: se borra la entrada de un proveedor autoalojable de la matriz, se ejecuta su verificación y se obtiene el resultado completo para volver a rellenarla, sin pasos manuales en el proveedor.

**Acceptance Scenarios**:

1. **Given** un proveedor autoalojable, **When** se lanza su verificación, **Then** se levanta una instancia efímera ya preparada con usuarios y grupos de prueba, se ejecutan todos los escenarios de US1 y la instancia se destruye al terminar, pase o falle.
2. **Given** Okta o Auth0 sin credenciales de prueba en el entorno, **When** se lanza su verificación, **Then** se omite e informa claramente de qué variables faltan, sin fallar el resto.
3. **Given** Okta o Auth0 con credenciales de su tenant de pruebas, **When** se lanza su verificación, **Then** se ejecutan los mismos escenarios de US1 contra el tenant.
4. **Given** una verificación completada, **When** alguien regenera la matriz, **Then** encuentra la versión, la fecha y el resultado de esa verificación, sin haber editado la tabla a mano.

---

### User Story 3 - Los proveedores que entregan los grupos de otra forma funcionan sin código específico (Priority: P2)

Cada proveedor entrega la pertenencia de otra manera:
- Auth0, en un claim con nombre de URL que añade una Action;
- Zitadel, como roles de proyecto;
- FusionAuth, como roles de aplicación;
- Authelia, solo en la información de usuario y no en el token de identidad.

El owner solo ajusta la configuración (claim de grupos y scopes), y el módulo sigue sin conocer ningún proveedor en concreto.

**Why this priority**: el principio VII de la constitución prohíbe fijar un proveedor en el código, y es lo que mantiene el módulo útil para cualquier usuario del fork. Sin esta historia, los proveedores «raros» obligarían a añadir excepciones.

**Independent Test**: con Auth0, Zitadel, FusionAuth y Authelia, un usuario del grupo de administración recibe el rol admin cambiando solo la configuración, sin cambios de código por proveedor.

**Acceptance Scenarios**:

1. **Given** un proveedor que envía los grupos en un claim cuyo nombre es una URL (p. ej. `https://example.com/groups`), **When** el owner configura ese nombre como claim de grupos, **Then** el sistema lee los grupos de ese claim.
2. **Given** un proveedor que no incluye los grupos ni la verificación del email en el token de identidad, pero sí en la información de usuario, **When** el usuario inicia sesión, **Then** el sistema los obtiene de la información de usuario y decide igual que con el resto.
3. **Given** un proveedor que envía los grupos como roles de aplicación en una lista, **When** el owner configura ese claim, **Then** esos roles se tratan como grupos.

### Edge Cases

- El proveedor envía el claim de grupos en el token y en la información de usuario con valores distintos: prevalece el del token de identidad, que está firmado.
- La información de usuario no responde a tiempo: el login se trata como un fallo del proveedor, con el mismo mensaje y registro que cualquier caída, y nunca como «sin grupos».
- El proveedor no marca el email como verificado (algunos no envían el dato por defecto): se rechaza igual que hoy (spec 001), y la guía indica cómo hacer que lo envíe.
- Un tenant SaaS de prueba caduca o cambia su configuración: la verificación falla con un error claro y la matriz conserva la última verificación válida, con su fecha.
- Una versión nueva de un proveedor rompe algo: la matriz lo registra como limitación conocida con la versión afectada, hasta que se corrija.
- Un proveedor devuelve un error no estándar ante un secreto incorrecto en la prueba de conexión: nunca se informa «conexión correcta», y la guía documenta el mensaje que verá el owner.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El módulo MUST quedar verificado con Keycloak, Okta, Auth0, Authentik, Zitadel, FusionAuth y Authelia. «Verificado» significa que ese proveedor pasa todos los escenarios de FR-004 contra una instancia real en la versión que registra la matriz (FR-010).
- **FR-002**: La guía de operación MUST incluir una sección por proveedor con estos pasos:
  - crear el cliente confidencial, la URL de retorno y la URL de retorno tras cerrar sesión;
  - los scopes necesarios;
  - cómo hacer que el proveedor envíe los grupos y la verificación del email;
  - qué claim de grupos configurar y un ejemplo de valores;
  - las limitaciones conocidas.
- **FR-003**: Los presets de la pantalla de SSO (spec 001, FR-024) MUST incluir también Auth0 y FusionAuth.
- **FR-004**: Cada proveedor MUST verificarse con la misma batería de escenarios, que son los de US1:
  - alta automática de un usuario del grupo de acceso;
  - rol admin por grupo de administración y member para el resto;
  - denegación fuera del grupo de acceso;
  - cambio de rol tras cambiar de grupo;
  - cierre de sesión en modo SSO-only, con fin de sesión en el proveedor o pantalla de «sesión cerrada»;
  - prueba de conexión con secreto correcto e incorrecto.
  - Cuando la spec 002 esté implementada, además: un usuario del grupo de gestión de usuarios puede gestionar usuarios y uno que solo es admin por otro grupo no puede. Hasta entonces, este escenario figura en la matriz como «pendiente de la spec 002».
- **FR-005**: Cuando el token de identidad no incluye el claim de grupos o la verificación del email, el sistema MUST obtenerlos de la información de usuario del proveedor. Si están en los dos sitios, MUST prevalecer el token de identidad. La información de usuario MUST descartarse, y el login denegarse, si su `sub` no coincide con el del token de identidad (OpenID Connect Core §5.3.2).
- **FR-006**: El nombre del claim de grupos MUST admitir cualquier texto, incluidos nombres con forma de URL, puntos, barras y dos puntos, y el sistema MUST tratarlo como un nombre literal, sin interpretarlo como ruta.
- **FR-007**: Las diferencias entre proveedores MUST resolverse con configuración o con reglas genéricas de OIDC, nunca con código dedicado a un proveedor concreto. Si una diferencia no se puede resolver así, MUST documentarse como limitación en la matriz.
- **FR-008**: Las verificaciones de Okta y Auth0 MUST ser opt-in:
  - leen las credenciales de su tenant de pruebas desde variables de entorno;
  - sin ellas, se omiten indicando qué variables faltan;
  - las credenciales MUST NOT aparecer en el repositorio, en los logs ni en los resultados.
- **FR-009**: Las verificaciones de los proveedores autoalojables MUST usar instancias efímeras:
  - se crean y se destruyen en cada ejecución;
  - usuarios, grupos y cliente de prueba se preparan de forma declarativa desde archivos del repositorio, sin secretos de ningún entorno real.
- **FR-010**: MUST existir una matriz de compatibilidad junto a la guía de operación. Por proveedor recoge:
  - la versión probada y la fecha de la última verificación;
  - el resultado de cada función: login, grupos, roles, denegación, cierre de sesión, fin de sesión en el proveedor y prueba de conexión;
  - las limitaciones conocidas.
- **FR-011**: La prueba de conexión MUST clasificar las respuestas de cada proveedor de forma que un secreto incorrecto nunca se informe como conexión correcta.
- **FR-012**: La spec 001 MUST remitir a esta spec para la lista de proveedores verificados, sin cambiar su propio alcance.
- **FR-013**: La funcionalidad MUST NOT depender de ningún código bajo licencia enterprise.
- **FR-014**: Cada verificación MUST guardar sus resultados en un archivo versionado con proveedor, versión, fecha y resultado por escenario. La tabla de la matriz MUST generarse desde esos archivos con un comando, sin editarse a mano. Las limitaciones conocidas son la única parte que se escribe a mano.

### Non-Functional Requirements

- **NFR-QA-001**: La verificación de un proveedor autoalojable, con el arranque de su instancia efímera incluido, MUST terminar en menos de 10 minutos.
- **NFR-QA-002**: Las verificaciones MUST NOT formar parte de la suite por defecto (`pnpm test`). Se lanzan de forma explícita, por proveedor o todas a la vez.
- **NFR-QA-003**: Las verificaciones de los cinco autoalojables MUST ejecutarse en CI una vez por semana y a demanda, y un fallo MUST quedar visible para el equipo. Okta y Auth0 MUST NOT ejecutarse en CI, porque sus credenciales no se guardan en GitHub.
- **NFR-SEC-001**: Los tenants de prueba de Okta y Auth0 MUST dedicarse solo a pruebas, sin usuarios ni datos reales, y sus credenciales MUST poder revocarse sin afectar a ningún entorno de Milpia.
- **NFR-PERF-001**: Leer la información de usuario (FR-005) MUST hacerse solo cuando falten datos en el token, con el mismo tiempo máximo de espera que el resto de llamadas al proveedor. MUST NOT añadir llamadas en los logins cuyo token ya trae los grupos.

### Key Entities

- **Resultado de verificación**: el archivo que deja cada ejecución, con proveedor, versión, fecha y resultado por escenario. Es la fuente de la matriz.
- **Proveedor verificado**: una fila de la matriz. Combina el último resultado de verificación del proveedor con sus limitaciones conocidas, que se escriben a mano.
- **Escenario de verificación**: uno de los escenarios comunes de FR-004, con el mismo significado para todos los proveedores.
- **Entorno de verificación**: una instancia efímera (autoalojables) o un tenant de pruebas (SaaS), con usuarios y grupos de prueba.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Los 7 proveedores pasan los escenarios de FR-004, o tienen cada limitación documentada en la matriz con su motivo.
- **SC-002**: Un operador que no conoce el módulo configura cualquiera de los 7 proveedores solo con la guía en menos de 30 minutos, hasta que un usuario del grupo de acceso entra.
- **SC-003**: Cualquier verificación de un proveedor autoalojable se repite con un solo comando y termina en menos de 10 minutos.
- **SC-004**: En ninguna ejecución de verificación la prueba de conexión da por buena una conexión con secreto incorrecto.
- **SC-005**: Sin credenciales de los tenants SaaS, lanzar todas las verificaciones completa las de los 5 autoalojables e informa de las 2 omitidas.
- **SC-006**: Ningún cambio de esta spec introduce código que nombre a un proveedor concreto fuera de presets, documentación y pruebas.

## Assumptions

- El módulo sigue siendo un cliente OIDC (relying party): la identidad, los grupos, la MFA y las políticas siguen en el proveedor. Esta spec no convierte Dokploy en un IAM ni en un PAM.
- «Autoalojables» son Keycloak, Authentik, Zitadel, FusionAuth y Authelia, que tienen imagen oficial para instancias efímeras. Okta y Auth0 solo existen como SaaS.
- El owner crea los tenants de desarrollo gratuitos de Okta y Auth0 y proporciona sus credenciales por entorno. Sin ellos, esas dos filas de la matriz quedan como «no verificado».
- Además de la ejecución semanal en CI (NFR-QA-003), las verificaciones se lanzan a mano antes de actualizar el fork o cuando cambia una versión de proveedor relevante. Okta y Auth0 solo se verifican en local.
- Se prueba la versión estable actual de cada proveedor en el momento de implementar. Las versiones antiguas no se cubren.
- El acceso de emergencia por túnel (spec 003) no depende del proveedor, porque usa la contraseña local del owner. Queda fuera de esta verificación y conserva su propia prueba.
- Depende de la spec 001 (módulo oidc-sso) en `canary`. Keycloak ya tiene su batería e2e, que se adapta a los escenarios comunes de FR-004.
