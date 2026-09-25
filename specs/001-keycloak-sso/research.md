# Research: SSO con Keycloak para la edición free

**Feature**: `001-oidc-sso` · **Fecha**: 2026-09-25

Cada entrada sigue el formato Decision / Rationale / Alternatives considered.

## R1. Cómo se integra con la autenticación existente

**Decision**: Un plugin propio de better-auth (`oidcSso()`), en un módulo nuevo
`packages/server/src/oidc-sso/`, registrado junto a los demás plugins en
`packages/server/src/lib/auth.ts`. El plugin expone sus endpoints bajo `/api/auth/oidc/*`
y añade un hook `before` que aplica el modo SSO-only a las rutas de login locales.

**Rationale**:
- El plugin recibe el contexto de better-auth (`internalAdapter`, `setSessionCookie`, cookies
  firmadas, rate limiting por ruta), así que la sesión que se emite es idéntica a la de un
  login local: mismo formato, mismas cookies, mismos hooks de sesión (`activeOrganizationId`).
- Es el punto de extensión que better-auth ofrece (abierto/cerrado): el único cambio en un
  archivo de upstream es añadir el plugin a la lista (principio II).
- No toca nada bajo `/proprietary` (principio I).

**Alternatives considered**:
- *Plugin `@better-auth/sso` (npm, ya instalado)*: su registro de proveedores, el enforce y la
  UI de Dokploy viven en `/proprietary` y comparten la tabla `sso_provider` con el SSO
  enterprise. Reutilizarlo mezclaría datos con la función de pago y obligaría a replicar sus
  pantallas propietarias. Rechazado por el principio I.
- *Plugin `genericOAuth` de better-auth*: su configuración es estática (se lee al arrancar,
  incumple FR-018), descarga el documento de discovery en cada login (incumple
  NFR-PERF-003), no envía ni valida `nonce` ni valida el ID token (incumple NFR-SEC-001/002),
  y su hook de creación de usuarios choca con `databaseHooks.user.create.before` de Dokploy.
- *Endpoints Next.js fuera de better-auth*: habría que reimplementar la emisión de sesión y de
  cookies, duplicando lógica sensible.

## R2. Librería OIDC

**Decision**: Añadir `openid-client` v6 (de panva) como dependencia de `packages/server`.

**Rationale**:
- Es un Relying Party con certificación OpenID. Implementa authorization code + PKCE, `state`
  y `nonce`, y valida el ID token (firma, `iss`, `aud`, `exp`, `iat`, `nonce`).
- Hace discovery y cachea el JWKS, refrescándolo cuando llega un `kid` desconocido
  (NFR-PERF-003).
- Construye la URL de logout iniciado por el cliente (`end_session_endpoint`, FR-010) y admite
  `customFetch` para fijar timeouts (NFR-PERF-004).
- Sus dependencias (`oauth4webapi`, `jose`) ya están en el árbol: `jose@6` viene con
  better-auth. Coste de dependencia bajo, justificado según las Restricciones técnicas.

**Alternatives considered**:
- *`jose` + código propio*: habría que reimplementar PKCE, discovery y validación del ID token.
  Es exactamente el código de seguridad que no conviene escribir a mano.
- *`oauth4webapi` directamente*: igual de seguro, pero más bajo nivel. `openid-client` ya lo
  envuelve con la misma garantía.

## R3. Estado de la transacción de login (state, nonce, PKCE, returnTo)

**Decision**: Una cookie firmada con el secreto de better-auth, `HttpOnly`, `SameSite=Lax`,
`Path=/api/auth/keycloak`, válida 10 minutos. Contiene `state`, `nonce`, `code_verifier` y
`returnTo`. Se borra al procesar el callback, tanto si sale bien como si falla.

**Rationale**:
- La cookie liga la transacción al navegador que la inició (NFR-SEC-001) y no necesita tabla
  ni limpieza.
- `SameSite=Lax` es necesario porque el callback llega como navegación GET de primer nivel
  desde Keycloak.
- El `code` es de un solo uso en Keycloak, y `state` y `nonce` se regeneran en cada intento.

**Alternatives considered**: guardarlo en la tabla `verification`. Supone una escritura y una
lectura de BD por login y basura que limpiar, sin ganar seguridad frente a una cookie firmada y
de vida corta.

## R4. Dónde se guarda la configuración y cómo se cachea

**Decision**:
- Una tabla nueva `oidc_sso_config` de una sola fila. El secreto del cliente se cifra con
  `encryptValue` (AES-256-GCM, `lib/encryption.ts`).
- Encima, un proveedor de configuración que:
  1. aplica los overrides de variables de entorno, que prevalecen (FR-019);
  2. cachea en memoria la configuración efectiva durante 5 s;
  3. se invalida en el acto al guardar desde la interfaz.
- El cliente OIDC (discovery más JWKS) se cachea por *huella* de configuración (issuer,
  client_id, secreto, flag de HTTP inseguro), así que un cambio de configuración crea un
  cliente nuevo.

**Rationale**:
- `webServerSettings` no tiene caché y se lee en cada hook (hallazgo del análisis).
- Añadir columnas allí tocaría una tabla de upstream que el enterprise también usa. Una tabla
  propia es aditiva (principio II).
- Con el TTL de 5 s, un despliegue con varios procesos converge en 5 s o menos
  (NFR-PERF-005). En el proceso que guarda, el cambio es inmediato.

**Alternatives considered**:
- *Columnas en `webServerSettings`*: rechazado por divergencia y acoplamiento.
- *Solo variables de entorno*: rechazado en la aclaración 4.

## R5. Variables de entorno

**Decision**: Prefijo `SSO_OIDC_`:

| Variable | Campo |
|---|---|
| `SSO_OIDC_MODE` | `disabled` \| `button` \| `sso-only` |
| `SSO_OIDC_ISSUER_URL` | URL del realm (`https://kc/realms/milpia`) |
| `SSO_OIDC_CLIENT_ID` | ID de cliente |
| `SSO_OIDC_CLIENT_SECRET` / `SSO_OIDC_CLIENT_SECRET_FILE` | secreto (el `_FILE` sigue el patrón de Docker secrets ya usado en `auth-secret.ts`) |
| `SSO_OIDC_ACCESS_GROUP` | grupo de acceso |
| `SSO_OIDC_ADMIN_GROUP` | grupo de administración |
| `SSO_OIDC_BUTTON_LABEL` | texto del botón |
| `SSO_OIDC_ALLOW_INSECURE_HTTP` | `true` solo en desarrollo |

**Rationale**: sigue el patrón `X` / `X_FILE` del repositorio y permite que Vault inyecte el
secreto.

## R6. Grupos de Keycloak

**Decision**:
- Se lee el claim `groups` del ID token. Si no aparece, se lee de la respuesta de `userinfo`,
  validando que `sub` coincide.
- Los valores se normalizan quitando la `/` inicial y se compara por ruta completa o por el
  último segmento. Así, `dokploy-users` coincide tanto con `/dokploy-users` como con
  `/equipos/dokploy-users`.
- La comparación distingue mayúsculas y minúsculas, como Keycloak.
- La guía de configuración pide un mapper *Group Membership* con el claim `groups`.

**Rationale**: es el mapper estándar de Keycloak. Normalizar evita errores de configuración
por la opción *Full group path*.

## R7. Política de acceso y de rol

**Decision**: una función pura, `decideAccess(input) → { allow, reason, role }`, con estas
reglas:

1. Sin `email` o con `email_verified !== true` → denegar (FR-006, casos límite).
2. Si el usuario vinculado o encontrado es el **owner** → permitir, sin comprobar grupos, y su
   rol no se toca (FR-008b).
3. Si hay un usuario existente baneado → denegar.
4. Si hay grupo de acceso configurado y el usuario no pertenece → denegar, sea nuevo o
   existente.
5. Usuario nuevo sin grupo de acceso configurado → denegar la creación (FR-007a).
6. Rol, si hay grupo de administración configurado: `admin` si pertenece, `member` si no
   (FR-008, FR-008a). Sin grupo de administración: los usuarios nuevos son `member` y los
   existentes conservan su rol.

**Rationale**:
- Falla de forma cerrada (principio III).
- Pedir el grupo de acceso también a los usuarios ya existentes hace que la regla «sale del
  grupo → pierde el acceso» sea uniforme (ver análisis A2).
- Eximir al owner de los grupos evita que un error de configuración en Keycloak lo deje fuera,
  y el owner siempre tiene además la vía de emergencia.
- Sin grupo de administración no se degrada a ningún admin existente por sorpresa.

## R8. Vinculación de identidades

**Decision**: la tabla `account` existente, con `providerId = "keycloak"` y
`accountId = sub`. La búsqueda se hace:

1. primero por `(providerId, accountId)`;
2. después por email verificado, solo si esa cuenta no tiene ya otro vínculo de Keycloak.

Se guarda `idToken` en la fila de `account`, porque es el único token necesario para el
logout (FR-010, NFR-SEC-007). Los tokens de acceso y de refresco no se guardan.

**Rationale**:
- Reutiliza la tabla estándar de better-auth, que es donde vive el concepto de «vínculo de
  identidad».
- El `sub` es estable aunque el usuario cambie de email.

## R9. Provisioning atómico

**Decision**: crear el usuario, su `account` y su `member` (en la organización del owner) en
**una transacción de Drizzle** dentro del endpoint de callback. La sesión se crea después con
`internalAdapter.createSession`.

**Rationale**:
- Los `databaseHooks.user.create` de Dokploy están pensados para registro, invitaciones y el
  SSO enterprise: rechazan crear usuarios si ya hay un owner y, sin owner, crean una
  organización.
- Insertar en una transacción evita tocar esos hooks (principio II) y garantiza que nunca
  quede un usuario sin membresía.
- Si no hay owner (instancia sin inicializar), el callback deniega el acceso: el registro
  inicial sigue siendo el de upstream.

## R10. Modo SSO-only, enlaces profundos y bucles

**Decision**:
- `pages/index.tsx` (login) redirige en `getServerSideProps` a `/api/auth/oidc/sign-in`
  cuando el modo es SSO-only, salvo en estos casos:
  - la URL trae `error`, para mostrar el error y el botón de reintentar (FR-016);
  - la URL trae `emergency=1`, que es la ruta de emergencia.
- Un `proxy.ts` de Next.js, sucesor de `middleware.ts` en Next 16, añade `returnTo` cuando se
  pide `/dashboard/*` sin cookie de sesión. La página de login la reenvía al endpoint de
  sign-in.

**Rationale**:
- Las ~46 páginas del dashboard redirigen a `/` por su cuenta y perderían la ruta pedida.
  Tocar cada una sería mucha divergencia.
- El proxy es un archivo nuevo y solo lee cookies, sin BD. Su coste es de microsegundos
  (NFR-PERF-001).

**Alternatives considered**: modificar las 46 páginas (rechazado por el principio II); usar
el `Referer` (poco fiable tras un 307).

## R11. Vía de emergencia

**Decision**:
- **Ruta web**: `/?emergency=1` muestra el formulario local, incluido el 2FA, con un aviso. El
  hook `before` del plugin, en modo SSO-only:
  - solo acepta `/sign-in/email` si el email es el del owner;
  - rechaza siempre registro, social, passkey y reset de contraseña.

  El control real está en el servidor: la URL solo decide qué se muestra.
- **Comando**: `apps/dokploy/scripts/oidc-sso-disable-sso-only.ts`, empaquetado con
  esbuild como `reset-password.ts`, con el script `pnpm run sso:disable-sso-only`. Pone
  el modo guardado en `button` y avisa si `SSO_OIDC_MODE` lo fuerza (FR-021).

**Rationale**:
- Mantener `/sign-in/email` conserva el 2FA del owner, en lugar de abrir una puerta paralela
  sin segundo factor.
- El comando sigue el patrón de `reset-password`.

## R12. Registro de eventos

**Decision**:
- Tabla propia `oidc_sso_auth_event` con: id, hora, tipo, resultado, email, userId, motivo,
  ip, `correlationId`, más un índice por fecha.
- Retención de 90 días, con limpieza oportunista como máximo una vez por hora en el proceso.
- El owner la consulta en la pantalla de configuración (últimos 50 eventos).

**Rationale**:
- El audit log de Dokploy es propietario y no hace nada sin licencia. Hace falta un registro
  independiente (principio I).
- 90 días es el valor habitual para registros de acceso y resuelve el punto de observabilidad
  que la aclaración dejó abierto.

## R13. Rate limiting

**Decision**: declarar reglas `rateLimit` en el plugin:
- `/oidc/*`: 20 por minuto por IP.
- `/sign-in/email` ya tiene la regla por defecto de better-auth (3 cada 10 s).

better-auth aplica el rate limiting en producción por defecto, con almacenamiento en memoria.

**Rationale**: reutiliza el mecanismo del framework en lugar de un limitador propio. Encaja
con la suposición del spec: «la ruta de emergencia usa la protección existente».

## R14. Convivencia con el SSO enterprise

**Decision**: la funcionalidad se considera **inactiva**, y se comporta como `disabled`,
cuando el owner tiene `enableEnterpriseFeatures && isValidEnterpriseLicense`. Son columnas de
la tabla `user` de upstream, no código propietario.

**Rationale**: cumple la precedencia del principio I sin importar nada de `/proprietary`.

## R15. Pruebas y medición

**Decision**:
- **Unitarias (Vitest, `apps/dokploy/__test__/oidc-sso/`)**: política de acceso, grupos,
  `returnTo`, merge de configuración y variables de entorno, caché, hook de SSO-only y
  endpoints con el cliente OIDC y la BD simulados.
- **Extremo a extremo**: un script en `apps/dokploy/__test__/oidc-sso/e2e/` que levanta
  Keycloak efímero en Docker con un realm de prueba importado. Se activa con
  `KEYCLOAK_E2E=1` y se ejecuta aparte.
- **Rendimiento**: un benchmark con `vitest bench` del hook y del procesamiento del callback,
  con la red simulada, para NFR-PERF-001/002. La prueba de carga de 50 logins se hace sobre el
  entorno e2e.
- **Cobertura**: con `@vitest/coverage-v8` limitada a `packages/server/src/oidc-sso/**`.

## R16. Lista de comprobación de seguridad (ASVS L2 / RFC 9700)

| Control | Cómo se cumple |
|---|---|
| Authorization code + PKCE S256 (RFC 9700 §2.1.1) | `openid-client`: `code_challenge_method=S256` siempre |
| `state` contra CSRF (RFC 9700 §4.7) | Aleatorio, en la cookie firmada, se valida en `authorizationCodeGrant` |
| `nonce` y validación del ID token (OIDC Core §3.1.3.7) | `expectedNonce`, firma, `iss`, `aud`, `exp`, `iat` validados por la librería |
| Sin implicit ni ROPC (RFC 9700 §2.1.2, §2.4) | Solo `response_type=code` |
| Redirect URI exacta (RFC 9700 §4.1) | URI fija `…/api/auth/oidc/callback`; la guía exige coincidencia exacta en Keycloak |
| Open redirect (ASVS 5.1.5) | `sanitizeReturnTo`: solo rutas relativas que empiezan por `/` y no por `//` ni `/\`, sin esquema |
| Sesión nueva tras login (ASVS 3.2.1) | `internalAdapter.createSession` emite un token nuevo |
| Cookies (ASVS 3.4) | Sesión: política de upstream sin cambios (`HttpOnly`, `SameSite=Lax`; en self-hosted upstream fija `secure:false`, se documenta como riesgo heredado). Cookie de transacción: `HttpOnly`, `SameSite=Lax`, firmada, `Secure` si la petición es HTTPS |
| Secretos (ASVS 6.4, 7.1.1) | Secreto cifrado en reposo, nunca devuelto por la API (solo `hasSecret`), sin tokens en logs |
| Mensajes de error (ASVS 7.4.1) | Códigos genéricos al usuario más `correlationId`; el detalle queda en el log del servidor |
| Anti-automatización (ASVS 2.2.1) | Rate limiting (R13) |
| Registro de eventos de seguridad (ASVS 7.2) | R12 |
| TLS (ASVS 9.2.1) | HTTPS obligatorio salvo el flag explícito de desarrollo, con aviso en la interfaz |
| Autorización en el servidor (ASVS 4.1.1) | Endpoints de configuración solo para el owner; política de acceso en el servidor |

## R17. Varios proveedores OIDC (FR-022 a FR-025)

**Decision**: nada de código específico por proveedor. Las diferencias reales se cubren con
configuración y con presets en la interfaz:

| Proveedor | Claim de grupos | Scope extra | Logout del proveedor |
|---|---|---|---|
| Keycloak | `groups` (mapper Group Membership o client scope `groups`) | — | sí |
| Okta | `groups` (claim del authorization server) | `groups` | sí |
| Authentik | `groups` (scope `profile` por defecto) | — | sí |
| Zitadel | `urn:zitadel:iam:org:project:roles` (objeto con los roles como claves) | `urn:zitadel:iam:org:projects:roles` | sí |
| Authelia | `groups` | `groups` | **no** |

- El claim de grupos admite lista, texto u objeto (de un objeto se usan sus claves). Así Zitadel
  funciona sin adaptador propio.
- Scopes adicionales configurables y validados (RFC 6749 §3.3). El scope base
  `openid email profile` no se puede quitar.
- Sin `end_session_endpoint`, el logout en SSO-only lleva a `/?signed_out=1`, que no redirige.
  Si no, `/` volvería a iniciar sesión en silencio.
- Los grupos de acceso y de administración admiten listas separadas por comas. La infraestructura
  de Milpia, por ejemplo, reutiliza sus grupos `admins` y `leads` en vez de crear grupos por
  servicio.
- La verificación de email sigue siendo estricta: los cinco proveedores envían `email_verified`.

**Alternatives considered**: un adaptador por proveedor (más código y más superficie sin ganar
funcionalidad), o detectar el proveedor por el documento de discovery (frágil, porque los nombres de
issuer no siguen ningún estándar).

## R18. Nombres genéricos

**Decision**: el módulo es `oidc-sso`, con las tablas `oidc_sso_*`, las variables `SSO_OIDC_*`, los
endpoints `/api/auth/oidc/*`, los códigos de error `sso_*` y el comando `sso:disable-sso-only`.
Keycloak queda como preset por defecto. La carpeta de la spec conserva su identificador
(`001-keycloak-sso`) para no romper la trazabilidad.
