# Contrato: endpoints HTTP del plugin (`/api/auth/keycloak/*`)

Todos los endpoints responden `404 NOT_FOUND` cuando la funcionalidad no está activa
(`EffectiveConfig.active = false`), para que una instancia con el SSO desactivado no exponga
ninguna superficie nueva. Todos tienen un rate limit de 20 peticiones por minuto por IP.

## `GET /api/auth/keycloak/sign-in`

Inicia el login.

| Query | Obligatorio | Descripción |
|---|---|---|
| `returnTo` | no | ruta interna a la que volver; se sanea con `sanitizeReturnTo` y, si no es válida, se usa `/dashboard/home` |

**Respuesta**: `302` a `authorization_endpoint` con `response_type=code`, `scope=openid email profile`,
`code_challenge` (S256), `state` y `nonce`. Además, establece la cookie firmada
`keycloak_sso_tx` (`HttpOnly`, `SameSite=Lax`, `Path=/api/auth/keycloak`, `Max-Age=600`).

**Errores**: si el discovery falla o tarda más de 5 s, responde
`302 /?error=keycloak_unavailable&ref=<correlationId>`.

## `GET /api/auth/keycloak/callback`

Es la URL de retorno que se registra en Keycloak: `<baseURL>/api/auth/keycloak/callback`.

| Query | Descripción |
|---|---|
| `code`, `state` | respuesta de autorización |
| `error`, `error_description` | error devuelto por Keycloak |

**Flujo**:
1. Lee la cookie de transacción y la borra.
2. Hace `authorizationCodeGrant` con `pkceCodeVerifier`, `expectedState`, `expectedNonce` e
   `idTokenExpected`.
3. Extrae los claims (y, si hace falta, `userinfo`).
4. Aplica `decideAccess`.
5. Vincula o crea el usuario en una transacción y recalcula el rol.
6. Crea la sesión y fija su cookie.
7. Registra el evento.

**Respuesta correcta**: `302` a `returnTo`.

**Respuesta de error**: `302 /?error=<code>&ref=<correlationId>`, con uno de estos códigos:

| `error` | Causa |
|---|---|
| `keycloak_cancelled` | el usuario canceló o Keycloak devolvió `access_denied` |
| `keycloak_invalid_response` | falta la cookie o ha caducado, `state` no coincide, el ID token no es válido |
| `keycloak_email_unverified` | falta el email o no está verificado |
| `keycloak_access_denied` | fuera del grupo de acceso, provisioning desactivado, usuario baneado o instancia sin owner |
| `keycloak_unavailable` | timeout o error de red o de Keycloak |
| `keycloak_clock_skew` | el ID token llega caducado o con fecha futura por diferencia de reloj |

## `GET /api/auth/keycloak/sign-out`

Cierra la sesión de Dokploy (si existe) y borra su cookie.
- En modo `sso-only`, responde `302` al `end_session_endpoint` de Keycloak con `id_token_hint`
  (si hay uno guardado), `client_id` y `post_logout_redirect_uri=<origin>/`.
- En modo `button`, o si Keycloak no está disponible, responde `302 /`.

## Hook `before` sobre rutas de upstream (modo `sso-only` activo)

| Ruta | Comportamiento |
|---|---|
| `/sign-in/email` | solo se permite si `email` es el del owner; si no, `403` con mensaje genérico. Se registra un evento `emergency_login` |
| `/sign-up/email` (incluye la aceptación de invitaciones, que usa esta ruta con `x-dokploy-token`) | `403` con el mensaje «Keycloak single sign-on is required on this instance. Ask your administrator to add you to the Keycloak access group.», que la página de invitación ya muestra como error |
| `/sign-in/social`, `/sign-in/passkey`, `/passkey/verify-authentication`, `/passkey/generate-authenticate-options`, `/request-password-reset`, `/forget-password`, `/reset-password` | `403` |
| resto | sin cambios |

El hook `after` sobre `/sign-in/email` registra si el login de emergencia del owner salió bien.
