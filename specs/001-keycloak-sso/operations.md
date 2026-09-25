# Guía de operación: SSO con Keycloak

Para quien instala o mantiene una instancia self-hosted de Dokploy. Cubre NFR-QA-005.

## 1. Configurar el cliente en Keycloak

En el realm de tu organización, **Clients → Create client**:

| Campo | Valor |
|---|---|
| Client type | OpenID Connect |
| Client ID | `dokploy` (o el que prefieras) |
| Client authentication | **On** (cliente confidencial) |
| Standard flow | On |
| Direct access grants, Implicit flow | Off |
| Valid redirect URIs | `https://<tu-dokploy>/api/auth/keycloak/callback` (exacta, sin comodines) |
| Valid post logout redirect URIs | `https://<tu-dokploy>/` |
| Advanced → Proof Key for Code Exchange | `S256` |

Luego, en **Credentials**, copia el *Client secret*.

### Mapper de grupos

**Client scopes → dokploy-dedicated → Add mapper → By configuration → Group Membership**:

| Campo | Valor |
|---|---|
| Name | `groups` |
| Token Claim Name | `groups` |
| Full group path | a tu elección. Dokploy acepta `dokploy-users` y `/equipos/dokploy-users` |
| Add to ID token | On (si está en Off, Dokploy lee los grupos de *userinfo*) |
| Add to userinfo | On |

### Grupos

- **Grupo de acceso** (p. ej. `dokploy-users`): quien pertenece entra y recibe cuenta en su primer login. Quien no pertenece es rechazado, salvo el owner.
- **Grupo de administración** (p. ej. `dokploy-admins`): sus miembros son admin; el resto, member. El rol se recalcula en cada login. Un cambio de rol hecho a mano en Dokploy se sobrescribe en el siguiente login del usuario.
- El **owner** nunca cambia de rol por Keycloak, aunque no pertenezca a ningún grupo.

Para quitar el acceso a alguien, sácalo del grupo de acceso o banéalo en Dokploy. Eliminarlo solo en Dokploy no basta: si sigue en el grupo, se le vuelve a crear la cuenta.

## 2. Configurar Dokploy

### Desde la interfaz

**Settings → Keycloak SSO** (solo lo ve el owner):

1. Rellena el issuer (`https://keycloak.example.com/realms/<realm>`), el client ID, el secreto y los grupos.
2. Pulsa **Test connection**.
3. Guarda con el modo **Button**.
4. Cierra sesión y entra con **Sign in with Keycloak** usando tu cuenta de owner. Así se verifica el issuer.
5. A partir de ahí puedes elegir **SSO-only**.

### Por variables de entorno (p. ej. desde Vault)

| Variable | Ejemplo |
|---|---|
| `KEYCLOAK_SSO_MODE` | `button` |
| `KEYCLOAK_SSO_ISSUER_URL` | `https://auth.milpia.com/realms/milpia-realm` |
| `KEYCLOAK_SSO_CLIENT_ID` | `dokploy` |
| `KEYCLOAK_SSO_CLIENT_SECRET_FILE` | `/run/secrets/keycloak_client_secret` |
| `KEYCLOAK_SSO_ACCESS_GROUP` | `dokploy-users` |
| `KEYCLOAK_SSO_ADMIN_GROUP` | `dokploy-admins` |
| `KEYCLOAK_SSO_BUTTON_LABEL` | `Entrar con Milpia` |

- Las variables mandan sobre lo guardado en la interfaz, y los campos que definen aparecen bloqueados en ella.
- Un cambio en las variables requiere reiniciar Dokploy.
- `KEYCLOAK_SSO_MODE=sso-only` solo surte efecto cuando el issuer ya está verificado; hasta entonces la instancia funciona en modo botón. Así una variable mal puesta no puede dejar a todos fuera.
- Usa `KEYCLOAK_SSO_ALLOW_INSECURE_HTTP=true` solo en desarrollo.

Si una instancia tiene licencia enterprise activa, prevalece su SSO propio y esta integración queda inactiva.

## 3. Procedimientos de emergencia

### Keycloak caído, el owner conoce su contraseña local

1. Abre `https://<tu-dokploy>/?emergency=1`.
2. Entra con el email y la contraseña local del owner (y su 2FA, si lo tiene).
3. En **Settings → Keycloak SSO**, cambia a **Button** o **Disabled**.

Solo la cuenta del owner puede entrar por esta ruta. Cada intento queda registrado en la tabla de eventos.

### El owner no recuerda su contraseña local

Desde el servidor, dentro del contenedor de Dokploy:

```bash
pnpm run keycloak:disable-sso-only        # vuelve a modo botón
pnpm run reset-password                    # contraseña nueva para el owner, si hace falta
```

En desarrollo, sin `dist/` compilado:

```bash
pnpm exec tsx -r dotenv/config scripts/keycloak-sso-disable-sso-only.ts
```

Si el comando termina con código 2, `KEYCLOAK_SSO_MODE=sso-only` está definido en el entorno. Quítalo y reinicia.

## 4. Diagnóstico

Cuando un login falla, el usuario ve un mensaje con una **referencia** (12 caracteres). Búscala:

- en la tabla **Recent authentication events** de la pantalla de configuración (columna *Reference*);
- en los logs del servidor: `Keycloak SSO [<referencia>] ... failed: ...`.

| Código visible (`?error=`) | Causa habitual |
|---|---|
| `keycloak_access_denied` | Fuera del grupo de acceso, usuario baneado, o email ya vinculado a otra identidad de Keycloak |
| `keycloak_email_unverified` | Keycloak no envía email o no lo marca como verificado |
| `keycloak_invalid_response` | La cookie de login caducó (más de 10 minutos en Keycloak), `state` no coincide o el ID token no es válido |
| `keycloak_unavailable` | Keycloak no responde en 5 s, error de red o TLS, o el secreto del cliente es incorrecto |
| `keycloak_clock_skew` | Los relojes de Dokploy y Keycloak difieren en más de 30 s (usa NTP) |
| `keycloak_cancelled` | El usuario canceló en Keycloak |

Los eventos se conservan 90 días.

## 5. Consideraciones de seguridad

- Con el login por Keycloak, el MFA lo aplica Keycloak. El 2FA local de Dokploy solo se pide en la ruta de emergencia.
- La cookie de sesión sigue la política de upstream. En self-hosted, Dokploy la emite sin `Secure`, así que sirve Dokploy siempre detrás de HTTPS.
- La URI de retorno se calcula a partir de la URL con la que se accede a Dokploy. Si hay un proxy delante, define `BETTER_AUTH_URL` (o la URL pública equivalente) para que coincida exactamente con la registrada en Keycloak.
