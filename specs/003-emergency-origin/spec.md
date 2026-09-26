# Feature Specification: Origen permitido para el acceso de emergencia por túnel

**Feature Branch**: `003-emergency-origin`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "Opción C del riesgo R4 de la spec 014 de infra: que el owner pueda usar la ruta de emergencia (`/?emergency=1`, spec 001 FR-012) a través de un túnel SSH hasta el contenedor (`http://localhost:3000`) cuando la instancia publica `https://deploy.milpia.com`. Hoy el login falla con 'Invalid origin' porque ese origen no es de confianza. Condiciones de infra: (1) el origen extra solo se acepta en la ruta de emergencia del owner (`/sign-in/email` bajo la guarda de SSO-only), nunca de forma global; (2) sin la variable, ningún origen extra (por defecto); (3) en prod será `http://localhost:3000`; (4) cada intento se sigue registrando. Motivo: con Keycloak caído, oauth2-proxy delante de Traefik no deja pasar a nadie, así que el único camino es el túnel directo al contenedor."

## Clarifications

### Session 2026-09-25

- Q: ¿Debe aceptarse el origen de emergencia también en la verificación del segundo factor (código TOTP o de respaldo) que sigue al login de emergencia del owner? → A: Sí: se acepta en la verificación TOTP y en la del código de respaldo, solo en modo SSO-only.
- Q: ¿Debe poder el owner cerrar sesión desde el origen de emergencia cuando termina? → A: Sí: se acepta también en el cierre de sesión, solo en modo SSO-only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El owner recupera el acceso por túnel con el proveedor de identidad caído (Priority: P1)

El proveedor de identidad está caído y la instancia está en modo SSO-only. Nadie llega al panel por la dirección pública. El owner abre un túnel SSH hasta el contenedor, entra en `http://localhost:3900/?emergency=1` e inicia sesión con su email y contraseña local. Llega al panel y puede, por ejemplo, desactivar SSO-only.

**Why this priority**: es la vía de recuperación que exige el principio III de la constitución. Sin ella, la vía web de emergencia de la spec 001 no sirve en el despliegue real de Milpia.

**Independent Test**: con SSO-only activo, la dirección pública configurada en `https://deploy.milpia.com` y el origen de emergencia configurado como `http://localhost:3900`, el owner inicia sesión desde `http://localhost:3900/?emergency=1` y llega al panel.

**Acceptance Scenarios**:

1. **Given** SSO-only activo y el origen de emergencia configurado, **When** el owner inicia sesión con su contraseña desde ese origen, **Then** entra al panel.
2. **Given** lo mismo y el owner con segundo factor activado, **When** completa el segundo factor desde ese origen, **Then** entra al panel.
3. **Given** un intento de emergencia desde ese origen, correcto o fallido, **When** el owner revisa los eventos del SSO, **Then** el intento aparece con su resultado, el email usado y el origen de emergencia.
4. **Given** SSO-only activo, el origen configurado y el owner dentro por el túnel, **When** cierra sesión desde el menú, **Then** la sesión termina.

---

### User Story 2 - El origen de emergencia no abre nada más (Priority: P1)

Desde el origen de emergencia, cualquier otra acción que dependa del control de orígenes se rechaza como hoy: el login de otro usuario, el registro, el restablecimiento de contraseña, las de organización y las de sesión, salvo cerrar la propia sesión. Fuera del modo SSO-only, el origen de emergencia no se acepta en ninguna ruta.

**Why this priority**: el origen de emergencia debilita a propósito una protección contra falsificación de peticiones (CSRF). Debe hacerlo en el mínimo sitio posible.

**Independent Test**: con el origen configurado, desde `http://localhost:3900` un usuario que no es el owner intenta iniciar sesión, y alguien intenta registrarse o pedir un restablecimiento de contraseña. Todo se rechaza. Con la instancia en modo botón, tampoco el owner puede iniciar sesión desde ese origen.

**Acceptance Scenarios**:

1. **Given** SSO-only activo y el origen configurado, **When** un usuario que no es el owner intenta iniciar sesión desde ese origen, **Then** se rechaza y queda registrado, igual que hoy.
2. **Given** SSO-only activo y el origen configurado, **When** llega desde ese origen cualquier otra acción que dependa del control de orígenes, **Then** se rechaza por origen no permitido.
3. **Given** la instancia en modo botón o con el SSO desactivado, **When** el owner intenta iniciar sesión desde el origen de emergencia, **Then** se rechaza por origen no permitido.

---

### User Story 3 - Sin configuración, nada cambia (Priority: P2)

Mientras nadie defina el origen de emergencia, Dokploy se comporta exactamente como hoy.

**Why this priority**: la funcionalidad está desactivada por defecto (principio II) y solo se activa en las instancias que la necesitan.

**Independent Test**: sin la variable, el owner no puede iniciar sesión desde `http://localhost:3900` en modo SSO-only y recibe el mismo error de origen que hoy.

**Acceptance Scenarios**:

1. **Given** el origen de emergencia sin definir, **When** llega cualquier petición, **Then** la lista de orígenes de confianza es idéntica a la actual.
2. **Given** un valor mal formado (con ruta, comodín o esquema distinto de http/https), **When** arranca la instancia, **Then** el valor se ignora, se registra un error de configuración en el log y no se añade ningún origen.

### Edge Cases

- El owner escribe mal su contraseña desde el origen de emergencia: se rechaza y se registra como intento fallido, igual que por la dirección pública.
- La petición llega desde el origen de emergencia pero con el email del owner en otra capitalización o con espacios: se trata como el owner, igual que la regla de emergencia actual.
- La instancia no tiene owner: no hay a quién aplicar la excepción, así que no se añade ningún origen.
- El origen de emergencia coincide con la dirección pública: no cambia nada.
- Tras entrar por el túnel, el owner usa el panel (proyectos, ajustes del SSO): funciona, porque esas acciones no pasan por el control de orígenes. Al terminar, cierra sesión desde el menú (FR-009). El resto de acciones que sí pasan por ese control (cambiar la contraseña, gestionar passkeys) siguen rechazándose desde el origen de emergencia.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST admitir un único origen de emergencia configurable solo por variable de entorno, sin ajuste en la interfaz.
- **FR-002**: El valor MUST ser un origen exacto (esquema `http` o `https`, host y puerto opcional), sin ruta, consulta ni comodines. Un valor que no cumpla MUST ignorarse y registrarse como error de configuración.
- **FR-003**: Sin origen de emergencia definido, la lista de orígenes de confianza MUST ser idéntica a la de upstream.
- **FR-004**: El sistema MUST aceptar el origen de emergencia solo cuando se cumplen a la vez tres condiciones: el modo SSO-only está activo, la petición es el login con email y contraseña, y el email es el del owner. Salvo en los casos de FR-005 y FR-009, MUST NOT aceptarlo en ninguna otra petición.
- **FR-005**: Con el modo SSO-only activo, el sistema MUST aceptar también el origen de emergencia en la verificación del segundo factor que sigue a un login de emergencia del owner: el código TOTP y el código de respaldo. MUST NOT aceptarlo en el resto de rutas del segundo factor (activarlo, desactivarlo, generar códigos).
- **FR-006**: Los usuarios que no son el owner MUST seguir siendo rechazados en la ruta de emergencia como hoy (spec 001, FR-012), vengan del origen que vengan.
- **FR-007**: El sistema MUST registrar cada intento de login de emergencia hecho desde el origen de emergencia, correcto o fallido, con el email, la IP, el resultado y una marca que indique que llegó por el origen de emergencia.
- **FR-008**: La funcionalidad MUST NOT depender de ningún código bajo licencia enterprise.
- **FR-009**: Con el modo SSO-only activo, el sistema MUST aceptar también el origen de emergencia en el cierre de sesión, para que el owner termine la sesión de emergencia desde el mismo navegador.

### Non-Functional Requirements

- **NFR-PERF-001**: Sin origen de emergencia definido, la funcionalidad MUST NOT añadir consultas ni más de 1 ms (p95) a ninguna petición.
- **NFR-PERF-002**: Con el origen definido, las peticiones que no sean de login MUST NOT tener ninguna consulta añadida.
- **NFR-SEC-001**: El origen de emergencia MUST añadirse solo a la lista de orígenes de la petición en curso, sin modificar ninguna lista compartida entre peticiones.
- **NFR-SEC-002**: Ante cualquier error al comprobar las condiciones de FR-004 (configuración ilegible, owner no encontrado), el sistema MUST NOT añadir el origen.

### Key Entities

- **Origen de emergencia**: ajuste de solo lectura que sale del entorno de la instancia. No se guarda en la base de datos.
- **Evento de login de emergencia**: el evento que ya existe en la spec 001, con una marca adicional de origen de emergencia.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con el proveedor de identidad caído, el owner recupera el acceso al panel por túnel en menos de 5 minutos siguiendo la guía de operación.
- **SC-002**: El 100 % de las peticiones desde el origen de emergencia que no sean el login del owner, su segundo factor o el cierre de sesión se rechazan en modo SSO-only.
- **SC-003**: Fuera del modo SSO-only, el 100 % de las peticiones desde el origen de emergencia se rechazan igual que hoy.
- **SC-004**: El 100 % de los intentos de emergencia desde ese origen quedan registrados.
- **SC-005**: Sin la variable, las pruebas actuales de login y de SSO pasan sin modificarse.

## Assumptions

- La variable se llama `SSO_OIDC_EMERGENCY_ORIGIN`, en línea con el resto de variables del SSO.
- Milpia la definirá como `http://localhost:3900` en lab y prod. El túnel es `ssh -L 3900:127.0.0.1:3000` por NetBird: el puerto 3000 de la Mac lo ocupan las apps en desarrollo, y en el VPS Dokploy sigue en el 3000, solo en loopback. El input original decía `http://localhost:3000`; el cambio de puerto lo decidió el owner después.
- Solo se contempla un origen: el caso de uso es un túnel. Una lista abre más superficie sin necesidad.
- No hay ajuste en la interfaz a propósito: quien puede cambiar el entorno del contenedor ya tiene acceso al host, y un ajuste en la base de datos podría activarlo un admin con acceso al panel.
- Las cookies de sesión de Dokploy en self-hosted no exigen HTTPS, así que la sesión funciona por `http://localhost`.
- Depende de la spec 001 (ruta de emergencia y guarda de SSO-only) ya integrada en `canary`.
