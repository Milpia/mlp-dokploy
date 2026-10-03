# Guía de operación: SSO por OpenID Connect

Para quien instala o mantiene una instancia self-hosted de Dokploy. Cubre NFR-QA-005 y FR-022 a
FR-025. Keycloak es el proveedor de referencia; Okta, Authentik, Zitadel y Authelia están soportados
mediante configuración (presets en la pantalla de settings).

## 1. Lo común a todos los proveedores

| En el proveedor | Valor |
|---|---|
| Tipo de cliente | OpenID Connect, **confidencial** (con secreto) |
| Flujo | Authorization code; PKCE `S256` si el proveedor lo permite configurar |
| Redirect URI | `https://<tu-dokploy>/api/auth/oidc/callback` (exacta) |
| Post-logout redirect URI | `https://<tu-dokploy>/` |
| Scopes | `openid email profile`, más el scope de grupos si el proveedor lo exige |
| Claims necesarios | `sub`, `email`, `email_verified: true` y el claim de grupos o roles |

**Grupos:**
- **Grupo de acceso**: uno o varios, separados por comas (p. ej. `admins,leads`). Quien pertenece a
  alguno entra y recibe cuenta en su primer login; el resto es rechazado, salvo el owner. Si está
  vacío, no se crean cuentas nuevas y solo pueden entrar usuarios que ya existían.
- **Grupo de administración**: sus miembros son admin y el resto member. El rol se recalcula en cada
  login. Si está vacío, los roles se gestionan en Dokploy.
- El **owner** de la instancia nunca cambia de rol por el proveedor.

Para quitar el acceso a alguien, sácalo del grupo de acceso o banéalo en Dokploy. Eliminarlo solo en
Dokploy no basta: si sigue en el grupo, se le vuelve a crear la cuenta.

## 2. Configuración por proveedor

Estado verificado de cada proveedor, con versión, fecha y resultado por escenario:
[matriz de compatibilidad](../004-oidc-provider-compatibility/compatibility.md) (spec 004). Cada
proveedor autoalojable se vuelve a verificar con `pnpm --filter=dokploy run e2e:oidc <proveedor>`.

Lo común a todos:
- **Redirect URI:** `https://<dokploy>/api/auth/oidc/callback`, exacta.
- **Post-logout redirect URI:** `https://<dokploy>/` (solo en modo SSO-only).
- **Cliente confidencial** con secreto. Dokploy siempre usa PKCE `S256`.
- **Scopes:** Dokploy pide `openid email profile`. Los «scopes adicionales» se suman a esos.
- **`email_verified`:** tiene que llegar como `true`, en el ID token o en userinfo. Dokploy consulta
  userinfo solo si al ID token le faltan los grupos, `email` o `email_verified`, y nunca sustituye lo
  que ya trae el ID token.

### Keycloak (referencia)

- **Issuer:** `https://<keycloak>/realms/<realm>`.
- **Cliente:** *Client authentication* On, *Standard flow* On, *Direct access grants* e *Implicit*
  Off; en *Advanced*, PKCE `S256`. *Valid redirect URIs* y *Valid post logout redirect URIs* con
  las URIs de arriba.
- **Grupos:** un mapper *Group Membership* con claim `groups` y *Add to ID token* activado, o un
  client scope `groups` asignado como **Default** (no Optional). *Full group path* puede estar
  activado o no: `admins` coincide tanto con `/admins` como con `/equipo/admins`.
- **Ejemplo:** claim `groups` → `["dokploy-users"]`. Scopes adicionales: ninguno.
- **Logout:** sí.

### Okta

- **Issuer:** `https://<org>.okta.com/oauth2/default`, el authorization server `default`. Es la
  dirección de la organización **sin `-admin`**: la de la consola de administración no coincide con
  el issuer y Dokploy la rechaza. El servidor de la organización (`https://<org>.okta.com`) también
  funciona, pero su claim de grupos solo se configura en la consola.
- **Aplicación:** *OIDC – Web Application*, grant *Authorization Code*, con las URIs de arriba y
  asignada a los usuarios o grupos que deban entrar.
- **Grupos:** en Security › API › Authorization Servers › `default` › **Claims**, añade el claim
  `groups` de tipo *ID Token*, valor *Groups*, filtro *Matches regex* `.*` e *Include in any scope*.
  Scopes adicionales: ninguno.
- **Access Policies** del servidor `default`: una política que incluya este cliente con una regla
  que permita *Authorization Code*. Sin ella, Okta responde «You are not allowed to access this app».
- **MFA:** las organizaciones nuevas exigen Okta Verify al inscribirse. Es una política de Okta:
  Dokploy no interviene, y el login funciona igual con MFA.
- **Logout:** sí (con `id_token_hint`).

### Auth0

- **Issuer:** `https://<tenant>.auth0.com/` (o el dominio regional, p. ej. `.us.auth0.com`), con la
  barra final.
- **Aplicación:** *Regular Web Application*, con *Allowed Callback URLs* y *Allowed Logout URLs*
  con las URIs de arriba.
- **Grupos:** Auth0 no tiene claim de grupos. Crea roles con los nombres que quieras usar como
  grupos y una **Action Post-Login** que los copie a un claim con namespace:
  `api.idToken.setCustomClaim("https://dokploy/groups", event.authorization.roles)`.
  Claim de grupos en Dokploy: `https://dokploy/groups`. Scopes adicionales: ninguno.
- **Tras desplegar o enlazar la Action**, Auth0 tarda unos segundos en aplicarla: los logins de ese
  intervalo llegan sin grupos.
- **Logout:** sí con el logout RP-initiated del tenant activado. Si no, Dokploy muestra su pantalla
  de «sesión cerrada».

### Authentik

- **Issuer:** `https://<authentik>/application/o/<slug>/`.
- **Proveedor** *OAuth2/OpenID*, cliente confidencial, *Redirect URI* en modo *strict* con la URI
  de arriba, y **`authorization_code` entre los grant types permitidos** (obligatorio desde 2025.x).
- **Grupos:** el scope mapping `profile` por defecto ya incluye `groups`.
- **`email_verified`:** Authentik lo envía como `false` por defecto. Crea un scope mapping para el
  scope `email` que devuelva `{"email": request.user.email, "email_verified": True}` y úsalo en lugar
  del de serie.
- **Logout:** sí. Al terminar, Authentik muestra su propia página de sesión cerrada.

### Zitadel

- **Issuer:** `https://<instancia>.zitadel.cloud` (o tu dominio).
- **Aplicación** *Web*, *Code*, autenticación POST o básica, con las URIs de arriba.
- **Grupos:** Zitadel usa **roles de proyecto**. Activa *Assert Roles on Authentication* en el
  proyecto y *User roles inside ID token* en la aplicación, y usa las claves de rol como grupos.
  - Claim de grupos: `urn:zitadel:iam:org:project:roles`.
  - Scopes adicionales: `urn:zitadel:iam:org:projects:roles`.
- **`email_verified`:** llega en el ID token con *User Info inside ID token*, o por userinfo.
- **Logout:** sí.

### FusionAuth

- **Issuer:** la URL pública de FusionAuth. **Hay que fijarla** en el tenant (*Tenants › Edit › General ›
  Issuer*): por defecto trae un valor de ejemplo y Dokploy rechaza el discovery.
- **Aplicación:** OAuth con autenticación de cliente obligatoria, *Authorized redirect URLs* con la
  redirect URI y *Logout URL* con la post-logout URI. Client ID: el ID de la aplicación.
- **Grupos:** crea roles de aplicación con los nombres de tus grupos y asígnalos a grupos de
  FusionAuth; registra a los usuarios en la aplicación. Pon la **política de scopes de la aplicación
  en «Compatibility»**: con «Strict», los roles no llegan al ID token.
  - Claim de grupos: `roles`. Scopes adicionales: `email`.
- **Logout:** sí (`/oauth2/logout`).

### Authelia

- **Issuer:** `https://<authelia>`. Authelia exige HTTPS y un dominio de cookie con punto.
- **Cliente** en `identity_providers.oidc.clients`: confidencial, `redirect_uris` con la redirect URI,
  scopes `openid email profile groups`, `grant_types: [authorization_code]` y
  `token_endpoint_auth_method: client_secret_post`. Scopes adicionales en Dokploy: `groups`.
- **Grupos y `email_verified`:** sin `claims_policy`, solo llegan por userinfo. Dokploy lo consulta
  automáticamente, así que no hace falta configurar nada más.
- **Logout: no** (sin `end_session_endpoint`, authelia#5057). En modo SSO-only, cerrar sesión lleva a
  una pantalla de «sesión cerrada» que no redirige sola. La sesión de Authelia sigue abierta hasta
  que caduque.

### Otro proveedor OIDC

Cualquier proveedor con discovery (`/.well-known/openid-configuration`) y ID tokens firmados.
Configura el claim que lleva los grupos o roles y los scopes necesarios para recibirlo. La prueba de
conexión comprueba el secreto revocando un token inventado cuando el proveedor publica
`revocation_endpoint` (RFC 7009), y si no, con un código de autorización inventado.

## 3. Configurar Dokploy

### Desde la interfaz

**Settings → OIDC SSO** (solo lo ve el owner de la instancia):

1. Elige el preset del proveedor. Rellena el claim de grupos y los scopes adicionales.
2. Completa el issuer, el client ID, el secreto y los grupos.
3. Pulsa **Test connection**.
4. Guarda con el modo **Button**.
5. Cierra sesión y entra con el botón de SSO usando tu cuenta de owner. Así se verifica el issuer.
6. A partir de ahí puedes elegir **SSO-only**.

### Por variables de entorno

| Variable | Descripción |
|---|---|
| `SSO_OIDC_MODE` | `disabled` \| `button` \| `sso-only` |
| `SSO_OIDC_ISSUER_URL` | issuer del proveedor |
| `SSO_OIDC_CLIENT_ID` | client ID |
| `SSO_OIDC_CLIENT_SECRET` / `SSO_OIDC_CLIENT_SECRET_FILE` | secreto (la variable directa prevalece) |
| `SSO_OIDC_ACCESS_GROUP` | grupo o lista separada por comas |
| `SSO_OIDC_ADMIN_GROUP` | grupo o lista separada por comas |
| `SSO_OIDC_GROUPS_CLAIM` | claim de grupos o roles (por defecto `groups`) |
| `SSO_OIDC_EXTRA_SCOPES` | scopes adicionales separados por espacios |
| `SSO_OIDC_BUTTON_LABEL` | texto del botón |
| `SSO_OIDC_ALLOW_INSECURE_HTTP` | `true` solo en desarrollo |
| `SSO_OIDC_EMERGENCY_ORIGIN` | origen exacto desde el que el owner puede usar la ruta de emergencia por un túnel (spec 003), p. ej. `http://localhost:3900` |
| `SSO_OIDC_USER_MANAGEMENT_GROUP` | grupo o lista separada por comas que puede gestionar usuarios (spec 002); vacío, rige upstream |
| `SSO_OIDC_GROUP_PROFILES` | JSON con los permisos, proyectos y entornos de solo lectura de cada grupo de members (specs 005 y 006, ver «Perfiles por grupo» y «Solo lectura por entorno»); vacío, se gestionan a mano |
| `SSO_OIDC_TRUSTED_PROXIES` | IPs o CIDR, separados por comas, de los proxies delante de Dokploy que amplían `X-Forwarded-For` (ver «Límites por IP detrás de Cloudflare»); vacío, rige upstream |

- Las variables mandan sobre lo guardado en la interfaz, y los campos que definen aparecen
  bloqueados en ella.
- Un cambio en las variables requiere reiniciar Dokploy.
- `SSO_OIDC_MODE=sso-only` solo surte efecto cuando el issuer ya está verificado; hasta entonces la
  instancia funciona en modo botón.
- Si la instancia tiene licencia enterprise activa, prevalece su SSO propio y esta integración queda
  inactiva.

#### Ejemplo: Milpia (Keycloak `milpia-infra`)

Adoptado: primero en el laboratorio y después en prod. Los valores definitivos los fija la spec 014 de
infraestructura (`contracts/sso-env.md`); en prod el modo es `sso-only`.

```dotenv
SSO_OIDC_MODE=sso-only
SSO_OIDC_ISSUER_URL=https://auth.milpia.com/realms/milpia-infra
SSO_OIDC_CLIENT_ID=dokploy
SSO_OIDC_CLIENT_SECRET=<desde PROD_ENV_FILE, con copia en Vault>
SSO_OIDC_ACCESS_GROUP=admins,leads
SSO_OIDC_ADMIN_GROUP=admins,leads
SSO_OIDC_USER_MANAGEMENT_GROUP=admins
SSO_OIDC_EMERGENCY_ORIGIN=http://localhost:3900
BETTER_AUTH_URL=https://deploy.milpia.com
```

En `milpia-infra`, el scope `groups` envía nombres sin ruta y debe estar como **Default** en el
cliente (ver MIL-213). El cliente `dokploy` se crea a mano y se documenta como as-built.

## 4. Procedimientos de emergencia

### El proveedor está caído y el owner conoce su contraseña local

1. Abre `https://<tu-dokploy>/?emergency=1`.
2. Entra con el email y la contraseña local del owner (y su 2FA, si lo tiene).
3. En **Settings → OIDC SSO**, cambia a **Button** o **Disabled**.

Solo la cuenta del owner puede entrar por esta ruta, y cada intento queda registrado.

### El proveedor está caído y la dirección pública no responde (túnel)

Si delante de Dokploy hay algo que también depende del proveedor (en Milpia, oauth2-proxy delante
de Traefik), la dirección pública deja de responder. En ese caso se entra por un túnel SSH directo
al contenedor. Requiere `SSO_OIDC_EMERGENCY_ORIGIN` con el origen local del túnel (spec 003).

1. Abre el túnel: `ssh -L 3900:127.0.0.1:3000 <servidor>`. El puerto local tiene que coincidir con
   el de `SSO_OIDC_EMERGENCY_ORIGIN` (`http://localhost:3900`).
2. Abre `http://localhost:3900/?emergency=1` (o `http://localhost:3900` si la instancia no está en
   SSO-only) y entra con el email y la contraseña local del owner. Si el owner tiene 2FA,
   introduce el código TOTP o un código de respaldo.
3. En **Settings → OIDC SSO**, cambia a **Button** o **Disabled** si hace falta. Si el modo
   viene de `SSO_OIDC_MODE`, hay que cambiar la variable y reiniciar. El túnel sigue sirviendo en
   cualquier modo, así que puedes volver a entrar por él.
4. Cierra sesión desde el menú (por el túnel no se pasa por el proveedor) y cierra el túnel.

Desde ese origen, en cualquier modo, solo se aceptan cinco peticiones:
- el login del owner;
- el TOTP;
- el código de respaldo;
- los dos cierres de sesión (el del menú y el de better-auth).

Todo lo demás se rechaza con 403: registro, restablecer o cambiar la contraseña, passkeys,
organización, y activar o desactivar el 2FA. El mensaje es «Invalid origin» o, en SSO-only, «Single
sign-on is required», según la petición. Cada intento por el túnel aparece una sola vez en los
eventos, con la marca «via emergency origin». El resto del panel (proyectos, ajustes del SSO)
funciona con normalidad.

### El owner no recuerda su contraseña local

Dentro del contenedor de Dokploy:

```bash
pnpm run sso:disable-sso-only        # vuelve a modo botón
pnpm run reset-password              # contraseña nueva para el owner, si hace falta
```

En desarrollo: `pnpm exec tsx -r dotenv/config scripts/oidc-sso-disable-sso-only.ts`.

Si el comando termina con código 2, `SSO_OIDC_MODE=sso-only` está definido en el entorno. Quítalo y
reinicia.

## 5. Diagnóstico

Cuando un login falla, el usuario ve un mensaje con una **referencia** de 12 caracteres. Búscala en
los eventos de autenticación (Settings › SSO › **Authentication events**) o en los logs del
contenedor:

- los errores técnicos: `OIDC SSO [<referencia>] <etapa> failed: ...`;
- cada evento rechazado o con error, sin emails:
  `OIDC SSO event type=<tipo> outcome=<denied|error> reason=<motivo> ref=<referencia> user=<id> action=<acción> target=<id>`.

`docker logs <contenedor> 2>&1 | grep 'ref=<referencia>'` encuentra la línea sin acceso a la base de
datos. Los logins correctos no se escriben en el log.

| Código (`?error=`) | Causa habitual |
|---|---|
| `sso_access_denied` | Fuera del grupo de acceso, usuario baneado, o el claim o scope de grupos está mal configurado |
| `sso_identity_mismatch` | El email ya está enlazado a otra identidad del proveedor: el realm se recreó, o el usuario se borró y se volvió a crear. Ver «Desenlazar una cuenta» |
| `sso_email_unverified` | El proveedor no envía email o no lo marca como verificado |
| `sso_invalid_response` | La cookie de login caducó (más de 10 minutos), `state` no coincide o el ID token no es válido |
| `sso_unavailable` | El proveedor no responde en 5 s, error de red o TLS, o secreto incorrecto |
| `sso_clock_skew` | Los relojes difieren en más de 30 s (usa NTP) |
| `sso_cancelled` | El usuario canceló en el proveedor |

Si un usuario del grupo recibe `sso_access_denied`, revisa que el token lleve el claim de grupos. Es
el error más frecuente con Okta, Authelia y Zitadel.

Los eventos se conservan 90 días.

### Desenlazar una cuenta (`sso_identity_mismatch`)

Dokploy guarda el identificador estable del usuario en el proveedor (`sub`). Si cambia (realm recreado, o usuario borrado y creado de nuevo con el mismo email), el login se rechaza para que otra identidad no pueda apoderarse de la cuenta. El evento del SSO con la referencia del usuario muestra el motivo `identity_conflict`.

Tras comprobar que la nueva identidad es la misma persona, borra su enlace y pídele que vuelva a entrar; se enlazará por su email verificado:

```sql
DELETE FROM account
WHERE provider_id = 'oidc'
  AND user_id = (SELECT id FROM "user" WHERE email = 'persona@ejemplo.com');
```

Si se recreó el realm entero, puedes borrar todos los enlaces (`DELETE FROM account WHERE provider_id = 'oidc';`): cada usuario se vuelve a enlazar en su siguiente login.

### Gestión de usuarios denegada (spec 002)

Con `SSO_OIDC_USER_MANAGEMENT_GROUP` definido, solo el owner y los miembros de ese grupo pueden
gestionar usuarios: borrar, invitar, cambiar roles o permisos y gestionar roles personalizados. El
resto de admins (en Milpia, `leads`) conserva todo lo demás y ve la lista de usuarios sin acciones.

- Los grupos se leen del último login por SSO. Un cambio de grupos en el proveedor se aplica en el
  siguiente login.
- El permiso caduca **8 horas** después de ese login. Pasado ese tiempo, el admin ve un aviso en
  Settings › Users y debe volver a entrar con SSO. El owner no depende del SSO.
- Si la comprobación falla (base de datos, configuración), la acción se deniega.
- Cada denegación queda en la tabla de eventos como `user_management` / `denied`, con la acción, el
  usuario afectado y la IP.

| Motivo | Mensaje | Qué hacer |
|---|---|---|
| `not_in_group` | `You are not allowed to manage users.` | Añadir al usuario al grupo en el proveedor y volver a entrar |
| `no_sso_login` | `Sign in with SSO to manage users.` | Entrar por SSO (un login local no basta) |
| `grant_expired` | `Your permission to manage users expired. Sign in with SSO again.` | Volver a entrar por SSO |
| `check_failed` | `You are not allowed to manage users.` (mismo texto, para no revelar el fallo) | Revisar los logs `OIDC SSO` y la base de datos |

### Perfiles por grupo (spec 005)

Con `SSO_OIDC_GROUP_PROFILES` (o el campo «Group profiles» de la pantalla de SSO), un member que
pertenece a un grupo con perfil recibe en **cada login por SSO** los permisos y los proyectos de su
grupo, sin que un admin tenga que marcarlos a mano. El formato completo está en
`specs/005-developer-access/contracts/env.md`:

```json
{
  "developers": {
    "permissions": [],
    "projects": ["milpia-web", "milpia-api"],
    "environments": { "exclude": ["production"] }
  }
}
```

- **`permissions`**: los permisos individuales de member de upstream (`canCreateServices`,
  `canAccessToDocker`…). Los que no aparecen quedan en `false`. Un perfil nunca da permisos de admin.
- **`projects`**: nombres de proyecto. Un proyecto nuevo solo entra cuando se añade a la lista. Si
  varios proyectos se llaman igual, entran todos.
- **`environments`** (opcional): `include` o `exclude` por nombre. `exclude: ["production"]` deja
  fuera el entorno de producción y sus servicios.
- **Sobrescribe**: lo que un admin haya puesto a mano se reemplaza en el siguiente login por SSO. La
  lista de usuarios marca a estos members con «SSO: <grupos>» y el diálogo de permisos lo avisa.
- **Revocación**: si la persona sale de todo grupo con perfil, o pasa a un grupo de admins, pierde
  permisos y proyectos en su siguiente login.
- **Caducidad**: el perfil caduca **8 horas** después del último login por SSO. La primera petición
  tras ese plazo vacía permisos y proyectos. La página de proyectos le pide volver a entrar por SSO.
- **Owner y admins**: nunca reciben perfil. Los members sin grupo con perfil no cambian.
- **Configuración inválida**: si la variable no es válida, los perfiles quedan **desactivados** (no
  se usa el valor guardado) y la pantalla de SSO muestra el error. Desde la pantalla, un valor
  inválido no se guarda.
- **Nombres que no coinciden**: bajo el campo, la pantalla avisa de los proyectos que no existen o
  que están repetidos. Mientras no se corrijan, esos nombres simplemente no dan acceso.

| Evento (`type` / `outcome` / `reason`) | Cuándo | Qué hacer |
|---|---|---|
| `sso_login` / `error` / `profile_failed` | falló al aplicar el perfil; el login se deshizo | revisar el log `OIDC SSO [<referencia>] group profile failed` y la base de datos |
| `member_profile` / `denied` / `profile_expired` | un member llevaba 8 h sin entrar por SSO | nada: al volver a entrar recupera su acceso |
| `member_profile` / `error` / `check_failed` | falló la comprobación de caducidad; se denegó la petición | revisar el log `OIDC SSO: group profile expiry check failed` |

Los tres también salen en el log del contenedor como `OIDC SSO event … ref=<referencia>` (T062).

Antes de añadir un grupo a `SSO_OIDC_ACCESS_GROUP` (y, en Milpia, a `deploy_access_groups` de
oauth2-proxy), su perfil tiene que estar configurado. Sin él, sus personas entran sin permisos ni
proyectos.

### Solo lectura por entorno (spec 006)

La clave `readOnly` del perfil de un grupo hace que sus personas **vean** esos entornos sin poder
cambiarlos. El formato está en `specs/006-read-only-access/contracts/env.md`:

- `"readOnly": true`: todos los entornos del grupo son de solo lectura.
- `"readOnly": ["production"]`: solo esos entornos. El resto del alcance tiene acceso completo.
- Los nombres deben estar dentro del alcance del grupo (en `include` y nunca en `exclude`); si no,
  la configuración entera se rechaza como en la spec 005.

Ejemplo de Milpia: `developers` operan staging y ven producción, y `qa` ve todo `milpia` salvo
producción, sin cambiar nada:

```json
{
  "developers": { "permissions": [], "projects": ["milpia"], "readOnly": ["production"] },
  "qa": {
    "permissions": [],
    "projects": ["milpia"],
    "environments": { "exclude": ["production"] },
    "readOnly": true
  }
}
```

**Qué se ve y qué no:**
- Se ven el proyecto, los entornos, los servicios, su estado, logs, monitorización e historial de
  despliegues, y la lista de backups con su fecha, resultado y tamaño.
- Las variables de entorno muestran sus **nombres** con el valor `••••••••`. Lo mismo para
  contraseñas, tokens de despliegue, el contenido de los archivos montados, el contenido del compose
  y los comandos personalizados. El tipo de build, la rama, el repositorio y la ruta del Dockerfile
  siguen visibles.
- Si un proyecto tiene algún entorno de solo lectura para la persona, las variables compartidas del
  proyecto también lo son, y no puede borrar ni duplicar el proyecto.
- Se rechaza cualquier cambio: desplegar, cancelar, arrancar, parar, variables, dominios,
  volúmenes, backups, restores, tareas programadas y la terminal de sus contenedores. El servidor lo
  rechaza siempre, también por la API con clave; la interfaz además lo indica y desactiva los
  botones.
- Quien tenga algún entorno de solo lectura tampoco abre la terminal del servidor ni usa las
  acciones de Docker del servidor, porque llegan a todos los entornos.

**Para todo member con perfil de grupo**, tenga o no solo lectura:
- la terminal y los logs de un contenedor solo se abren desde el servicio al que pertenece el
  contenedor;
- los logs de despliegue en directo solo se ven para servicios de su alcance y con el perfil
  vigente.

**Varios grupos:** si un grupo da acceso completo a un entorno y otro solo lectura, gana el acceso
completo.

**Cuándo se aplica:** en cada login por SSO, y caduca a las 8 horas como el resto del perfil. Un
cambio de configuración llega en el siguiente login. Quitar `readOnly` devuelve el acceso completo
en el siguiente login; mientras tanto, la persona sigue en solo lectura.

**Antes de activar la solo lectura en un entorno que el grupo ya podía ver con acceso completo:** los
tokens de despliegue (`refreshToken`) y las contraseñas que esas personas pudieron ver siguen siendo
válidos. Si hace falta, rótalos al activarla.

La pantalla de SSO avisa de los nombres de `readOnly` que no coinciden con ningún entorno de los
proyectos del grupo: una errata dejaría ese entorno con acceso completo.

**Límites que conviene conocer:**
- La solo lectura protege los entornos dentro del panel. **No aísla entornos que comparten
  servidor**: quien tiene acceso completo a un servicio puede, con los permisos normales de upstream
  (volúmenes, backups, compose), llegar a otros recursos del mismo servidor. Para que producción esté
  aislada de verdad, ejecútala en un servidor distinto del de staging.
- Si se vacía `groupProfiles` (o la variable deja de ser válida), la solo lectura se desactiva
  junto con el resto de perfiles, y los members conservan el alcance que tenían, **incluidos los
  entornos que eran de solo lectura**, ahora con acceso completo (como en la spec 005). Antes de
  desactivar los perfiles, revisa y recorta a mano el alcance de esos members.

| Evento (`type` / `outcome` / `reason`) | Cuándo | Qué hacer |
|---|---|---|
| `member_profile` / `denied` / `read_only` | alguien intentó cambiar algo de solo lectura; `action` es el procedimiento (o `wss:terminal`, `wss:docker-container-terminal`) y el recurso, el servicio, entorno o proyecto | nada, salvo que se repita: confirmar con la persona si su grupo debería tener acceso completo |
| `member_profile` / `denied` / `container_mismatch` | se pidió la terminal o los logs de un contenedor que no es del servicio indicado | revisar quién y desde dónde; la interfaz nunca lo pide así |
| `member_profile` / `denied` / `out_of_scope` | se pidió el log de un despliegue fuera del alcance | igual que el anterior |
| `member_profile` / `error` / `read_only_check_failed` | falló la comprobación; se denegó la acción | revisar los logs `OIDC SSO: read-only check failed`, `container binding check failed`, `deployment log check failed` o `server terminal check failed` |

Estos eventos también salen en el log del contenedor, con `resource=<id>`.

## 6. Consideraciones de seguridad

- **MFA:** con SSO, el MFA lo aplica el proveedor. El 2FA local de Dokploy solo se pide en la ruta de
  emergencia.
- **Quién configura:** solo el **owner de la instancia**, no el owner de cualquier organización.
- **Cookie de sesión:** sigue la política de upstream. En self-hosted se emite sin `Secure`, así que
  sirve Dokploy siempre detrás de HTTPS.
- **URL pública:** detrás de un proxy, define `BETTER_AUTH_URL` con la URL pública para que la
  redirect URI coincida exactamente con la registrada en el proveedor.
- **SSO-only no afecta a:** las API keys ni los endpoints SAML del SSO enterprise, que siguen
  funcionando en modo SSO-only (decisión explícita).
- **Límites por IP detrás de Cloudflare:** better-auth limita algunas rutas por IP, por ejemplo
  20 peticiones por minuto a `/api/auth/oidc/*`. Toma la IP de `X-Forwarded-For`, nunca de la
  conexión. Sin `SSO_OIDC_TRUSTED_PROXIES` solo acepta esa cabecera si trae una única IP. Cuando
  Traefik confía en Cloudflare (`trustedIPs`), la cabecera llega como «cliente, edge de
  Cloudflare» y todo el tráfico caería en un solo contador. Para que cuente por persona:
  - pon en `SSO_OIDC_TRUSTED_PROXIES` los rangos IPv4 e IPv6 de Cloudflare, los mismos que en
    `trustedIPs` de Traefik. Traefik no aparece en la cabecera, así que su IP no hace falta; la red
    de Dokploy (`dokploy-network`) es opcional y solo sirve si hay otro proxy entre Traefik y Dokploy;
  - despliega la variable a la vez que `trustedIPs`, o antes, nunca después;
  - el puerto 3000 de Dokploy no debe ser accesible sin pasar por Traefik: quien llegue directo puede
    escribir su propio `X-Forwarded-For` y elegir la IP con la que se le cuenta.
- **Sonda de salud:** usa `GET /api/health`, que responde 200 sin sesión ni límites. La raíz, en
  SSO-only, redirige al inicio de sesión por SSO y acaba recibiendo 429 del límite de
  `/api/auth/oidc/*`.
