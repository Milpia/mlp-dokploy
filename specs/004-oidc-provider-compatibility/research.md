# Research: Compatibilidad verificada con siete proveedores OIDC

Decisiones de la fase 0, en formato Decision / Rationale / Alternatives.

La investigación por proveedor se hizo contra la documentación oficial vigente en septiembre de 2026 y está resumida en R2. Los puntos marcados **[verificar]** no se pudieron confirmar en la documentación y los comprobará la primera ejecución de cada verificación.

## R1. Qué le falta al módulo

**Decision**: dos cambios de código y ninguno específico de un proveedor.

1. **Información de usuario (FR-005).** `oidc/client.ts` ya pide la información de usuario cuando falta el claim de grupos en el ID token, y `openid-client` comprueba que el `sub` coincida con el esperado (`fetchUserInfo(config, accessToken, expectedSubject)`). Pero no completa `email` ni `email_verified`. Se amplía para cubrir tres claims: el de grupos, `email` y `email_verified`.
   - Se pide la información de usuario solo si falta alguno de los tres en el ID token.
   - Se rellenan solo los que faltan, así que el ID token prevalece.
   - Un `sub` distinto hace fallar el login con `sso_invalid_response`.

   Authelia envía por defecto esos tres claims solo en la información de usuario, y Zitadel envía ahí `email_verified`.
2. **Presets (FR-003).** Se añaden a `provider-presets.ts`:
   - Auth0: claim de grupos con namespace, ejemplo `https://dokploy/groups`, sin scope extra;
   - FusionAuth: claim `roles`, scope `email`.

   Se revisan las pistas del resto con lo aprendido en R2.

**Rationale**: con estos dos cambios, las diferencias de R2 se resuelven con configuración, como pide FR-007.

**Alternatives considered**:
- Pedir siempre la información de usuario. Añade una llamada en cada login, lo que va contra NFR-PERF-001.
- Exigir que cada proveedor meta los claims en el ID token. Obliga a configurar Authelia y Zitadel de más y deja fuera instalaciones por defecto.

## R2. Diferencias entre proveedores

| Proveedor | Versión objetivo | Arranque declarativo | Grupos: claim y dónde | `email_verified` | Fin de sesión | Código falso / secreto malo | HTTPS | Login automatizado |
|---|---|---|---|---|---|---|---|---|
| Keycloak | 26.7.4 | realm JSON (`--import-realm`) | `groups` (lista, mapper); ID token y userinfo | ID token | sí | `invalid_grant` / 401 `invalid_client` o `unauthorized_client` | no | formulario de una página |
| Authentik | 2026.8.3 | blueprints YAML + variables de bootstrap | `groups` (lista, scope profile); ID token | **false por defecto**: el blueprint añade un scope mapping `email` con `email_verified: True` | sí, por aplicación | `invalid_grant` / `invalid_client` | no | flujo en dos pasos (web components) |
| Zitadel | v4.19.0 (evitar v4.18.0) | `ZITADEL_FIRSTINSTANCE_*` + script de siembra con PAT | `urn:zitadel:iam:org:project:roles` (objeto); userinfo, o ID token con opción de app | userinfo (ID token con opción) | sí | `invalid_grant` / 401 `invalid_client` **[verificar]** | no | multipaso (Login V2); desactivar la invitación a MFA |
| FusionAuth | 1.69.2 | `kickstart.json` | `roles` (lista de roles de aplicación, dados por grupos); ID token | ID token | sí (`/oauth2/logout`) | **`invalid_request` + `auth_code_not_found` [verificar]** / 401 `invalid_client` | no | formulario de una página |
| Authelia | 4.39.28 | `configuration.yml` + `users_database.yml` | `groups` (lista); **solo userinfo** salvo `claims_policy` | userinfo | **no** (issue #5057) | `invalid_grant` / 401 `invalid_client` | **sí** | formulario de una página + consentimiento |
| Okta | Integrator Free | script de siembra (Management API) | `groups` (lista, filtro de la app); ID token | ID token | sí (`id_token_hint`) | `invalid_grant` / 401 `invalid_client` | SaaS | identificador y contraseña en dos pasos; política sin MFA |
| Auth0 | plan gratuito | script de siembra (Management API) | claim con namespace mediante una Action Post-Login con los roles; ID token | ID token | sí (`/oidc/logout`, opción del tenant) | **403** `invalid_grant` / **401 `access_denied`** | SaaS | Universal Login + consentimiento en localhost |

**Consecuencias para la prueba de conexión (FR-011).** La clasificación actual trata como credencial inválida `invalid_client`, `unauthorized_client` y cualquier 401. Todo lo demás lo da por válido, porque llega después de autenticar al cliente. Con eso ya quedan cubiertos:
- Auth0, cuyo secreto malo devuelve 401 `access_denied`;
- FusionAuth, cuyo código falso devuelve `invalid_request`.

No se cambia el código. Las verificaciones confirman los dos casos (escenario de secreto incorrecto) y, si algún proveedor se desvía, se corrige con su prueba de regresión.

**Fin de sesión.** Cuando no hay `end_session_endpoint`, como en Authelia, ya se muestra la pantalla de «sesión cerrada» (spec 001, FR-025). No hay cambio.

## R3. Cómo se completa el login en el proveedor

**Decision**: la parte del proveedor la hace un navegador sin interfaz, `playwright-core` con Chromium. La parte de Dokploy sigue siendo el `auth.handler` real de better-auth, en proceso, como en la e2e actual de Keycloak.
- El navegador intercepta con `page.route` las peticiones a `http://localhost:3000/**` y las responde con `auth.handler`, así que no hace falta arrancar el servidor de Dokploy.
- Cada proveedor aporta solo un «conductor» de login: los selectores de usuario, contraseña y enviar, y cómo aceptar el consentimiento si lo hay.

**Rationale**: Authentik, Zitadel, Authelia, Okta y Auth0 usan SPA o flujos multipaso. Simularlos con `fetch` exigiría reimplementar la API privada de cada uno. Con un navegador, el conductor queda en unas pocas líneas por proveedor y prueba el flujo que ve un usuario real.

**Alternatives considered**:
- Generalizar la simulación con `fetch` de la e2e actual. Solo sirve para Keycloak y FusionAuth.
- `@playwright/test` como runner. Duplica Vitest. Basta con la librería.
- Puppeteer. Equivalente, pero `playwright-core` gestiona mejor el TLS autofirmado (`ignoreHTTPSErrors`) y la redirección de hosts.

**Dependencia nueva** (restricciones técnicas de la constitución): `playwright-core` como dependencia de desarrollo de `apps/dokploy`, y el navegador se instala con `pnpm exec playwright-core install chromium`. No entra en la imagen de producción.

## R4. Entornos de verificación

**Decision**: un directorio por proveedor en `apps/dokploy/__test__/oidc-sso/providers/<id>/` con:
- `compose.yml`: imágenes fijadas por versión, puertos solo en `127.0.0.1` y sin volúmenes persistentes;
- la semilla declarativa: realm JSON, blueprint, `kickstart.json`, `configuration.yml` o un script de siembra;
- `driver.ts`: el conductor de login y los valores de configuración del módulo (issuer, claim, scopes).

**Un runner** `apps/dokploy/scripts/oidc-providers.ts`, expuesto como `pnpm run e2e:oidc <id|all>`, se encarga de:
- levantar el compose, esperar al discovery y ejecutar la semilla si es un script;
- lanzar la batería de Vitest con las variables del proveedor;
- escribir el archivo de resultados (R6);
- destruir el compose con `down -v` siempre, en un `finally`.

**Authelia necesita HTTPS**, y su dominio no puede ser `localhost`:
- el runner genera una CA autofirmada por ejecución con `openssl`;
- usa el host `auth.localtest.me`, que resuelve públicamente a `127.0.0.1`, así que no hay que tocar `/etc/hosts`;
- pasa la CA a Node con `NODE_EXTRA_CA_CERTS` y a Chromium con `ignoreHTTPSErrors`.

**Okta y Auth0** no levantan nada. Su semilla es un script idempotente contra la Management API, que crea la app, los grupos o roles, los usuarios y la Action si faltan. Lee las credenciales de variables `OKTA_E2E_*` y `AUTH0_E2E_*`. Sin ellas, el runner marca el proveedor como omitido.

**Rationale**:
- Cumple el principio IV (instancias efímeras) y FR-009 (siembra declarativa desde el repo).
- La siembra de Okta y Auth0 con scripts propios evita añadir Terraform al toolchain.

**Alternatives considered**:
- Terraform para Okta y Auth0. Es declarativo, pero añade una herramienta y un estado que habría que guardar.
- Testcontainers. Es otra dependencia, y `docker compose` ya está en todos los entornos.

## R5. Batería común

**Decision**: un único archivo de pruebas, `apps/dokploy/__test__/oidc-sso/providers/battery.e2e.test.ts`, parametrizado por el proveedor activo (`OIDC_E2E_PROVIDER`). Recorre los escenarios de FR-004:
- alta automática en el grupo de acceso;
- rol admin por el grupo de administración y member para el resto;
- denegación fuera del grupo;
- cambio de rol;
- cierre de sesión en SSO-only, con fin de sesión en el proveedor o pantalla de «sesión cerrada»;
- prueba de conexión con el secreto correcto y con uno incorrecto;
- y, cuando exista la spec 002, el grupo de gestión de usuarios.

Cada proveedor declara sus usuarios de prueba con los mismos papeles (`member`, `admin`, `outsider`, `manager`) y sus grupos equivalentes: roles en Zitadel, FusionAuth y Auth0.

La e2e actual de Keycloak (`e2e/keycloak.e2e.test.ts`) se mantiene por sus escenarios propios (50 logins concurrentes, redirección con `returnTo`). Sus escenarios comunes se reescriben dentro de la batería, y Keycloak pasa a ser un proveedor más.

**Rationale**: las mismas pruebas para todos son lo que hace comparable la matriz. SC-006 se cumple porque todo lo específico de un proveedor vive en `providers/<id>/`, fuera del módulo.

## R6. Resultados y matriz

**Decision**:
- Cada ejecución escribe `specs/004-oidc-provider-compatibility/results/<id>.json`, un archivo por proveedor que se sobrescribe con la última ejecución.
- `pnpm run e2e:oidc:matrix` genera `specs/004-oidc-provider-compatibility/compatibility.md` a partir de esos archivos y de `limitations.md`, que se escribe a mano.
- `specs/001-keycloak-sso/operations.md` enlaza a la matriz.

**Rationale**:
- Los resultados versionados en git dan el historial y la revisión en PR que pide FR-014.
- Separar las limitaciones en su propio archivo respeta la decisión del clarify: solo esa parte se escribe a mano.

**Alternatives considered**: guardar solo artefactos de CI. Caducan y no quedan en el repo.

## R7. CI

**Decision**: `.github/workflows/milpia-oidc-providers.yml`.
- Se lanza a mano (`workflow_dispatch`) y cada semana (`schedule`, lunes).
- Usa una matriz con los 5 proveedores autoalojables: cada job ejecuta `pnpm run e2e:oidc <id>` y sube `results/<id>.json` como artefacto.
- Si un proveedor falla, falla su job, y GitHub avisa por correo a quien lanzó o programó el workflow.
- No escribe en el repo, porque la opción C del clarify quedó descartada.
- Okta y Auth0 no están en la matriz de CI (NFR-QA-003).

**Rationale**: cumple NFR-QA-003. Los tiempos esperados (R2: arranques de entre 5 y 90 segundos) quedan dentro de NFR-QA-001.

## R8. Seguridad

- Los tenants de Okta y Auth0 son solo de prueba (NFR-SEC-001).
- Sus credenciales viven en variables de entorno locales, nunca en el repo ni en GitHub. El runner las redacta de cualquier salida y de los archivos de resultados (FR-008).
- Los secretos de las instancias efímeras (secretos de cliente, contraseñas de prueba, claves de firma) son valores de prueba fijos en el repo. Dan acceso solo a contenedores que solo escuchan en `127.0.0.1` y se destruyen al terminar. Un `README.md` en `providers/` lo explica, para que nadie los confunda con secretos reales.
- La información de usuario nunca sustituye a un claim presente en el ID token, que está firmado. Una discrepancia de `sub` deniega el login (FR-005).
