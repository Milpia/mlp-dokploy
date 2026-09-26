# Research: Origen permitido para el acceso de emergencia por túnel

Decisiones de la fase 0, en formato Decision / Rationale / Alternatives. El comportamiento de
better-auth se verificó en el código de la versión 1.6.23 instalada (`node_modules/.pnpm/better-auth@1.6.23…/dist`).

## R1. Dónde comprueba better-auth el origen

**Hallazgo**: una petición POST a `/api/auth/*` pasa por dos comprobaciones de origen, en este
orden:

1. **Middleware del router** (`api/index.mjs:155-158`): `originCheckMiddleware` en `/**`. Si la
   petición trae cookies, ejecuta `validateOrigin` (`middlewares/origin-check.mjs:95-114`).
   Por el túnel sí habrá cookies, porque las cookies de `localhost` no distinguen puerto y el
   navegador del owner ya tiene las de las apps en desarrollo. También valida `callbackURL`.
2. **Middleware del endpoint**: `formCsrfMiddleware` en `/sign-in/email` (`routes/sign-in.mjs:146`).
   Si hay cabeceras `Sec-Fetch-*` u `Origin`, fuerza `validateOrigin`.

Los hooks `before` de los plugins se ejecutan entre las dos (`api/dispatch.mjs:207`). El hook de
upstream que recalcula `ctx.context.trustedOrigins` (`packages/server/src/lib/auth.ts:125`) solo
afecta a la segunda.

La lista de confianza es la unión de:
- `ctx.context.trustedOrigins`;
- el resultado de `options.trustedOrigins(request)`, la función `resolveTrustedOrigins` de
  `auth.ts:36-64`.

`http://localhost:3900` no está en ninguna de las dos.

**Consecuencia**: un hook `before` que amplíe la lista llega tarde para la primera comprobación.

## R2. Punto de enganche

**Decision**: usar `onRequest` de nuestro plugin `oidcSso()`. better-auth lo ejecuta antes del
router (`api/index.mjs:167-172`) y le permite devolver una petición sustituta. Si se cumplen todas
las condiciones de R3, el plugin devuelve una copia de la petición con la cabecera `Origin` cambiada
por el origen público de la instancia (el de `BETTER_AUTH_URL`) y sin `Referer`. Las dos
comprobaciones de R1 ven así un origen de confianza.

**Rationale**:
- Es el único punto que llega antes de las dos comprobaciones sin tocar upstream (principio II).
- No toca ninguna lista compartida: la sustitución vive solo en esa petición (NFR-SEC-001).
- No desactiva la comprobación. Solo traduce un origen concreto, en rutas concretas, a otro que
  ya es de confianza.

**Alternatives considered**:
- Añadir el origen en `resolveTrustedOrigins` (`auth.ts`) según la petición. Toca upstream, y esa
  función no conoce ni el modo SSO-only ni al owner sin duplicar lógica del módulo.
- Hook `before` que amplía `ctx.context.trustedOrigins`: llega tarde a la comprobación del router
  (R1).
- `advanced.disableCSRFCheck` o `skipOriginCheck` por ruta: desactivan la protección para
  cualquier origen, lo contrario de lo que se busca.
- Poner el origen en `user.trustedOrigins` con SQL: global y permanente (lo que infra descartó).

## R3. Condiciones para sustituir el origen

**Decision**: el plugin sustituye el origen solo si se cumplen **todas** estas condiciones.
Cualquier excepción deja la petición intacta, con lo que falla en cerrado (NFR-SEC-002).

1. `SSO_OIDC_EMERGENCY_ORIGIN` está definido y es válido (R5). Si no, el plugin sale sin leer
   nada (NFR-PERF-001).
2. El método es `POST`.
3. La cabecera `Origin` coincide exactamente, como texto, con el origen configurado.
   - Si no hay `Origin`, se usa el origen de `Referer`.
   - Si no hay ninguno de los dos, no se sustituye.
4. La ruta, relativa al `basePath` de better-auth, es exactamente una de estas:
   - `/sign-in/email`
   - `/two-factor/verify-totp`
   - `/two-factor/verify-backup-code`
   - `/sign-out`
   - `/oidc/sign-out` (el cierre de sesión del menú de Dokploy; enmienda 2026-09-26)
5. *(Retirada en la enmienda del 2026-09-26: ya no se exige el modo SSO-only. Con el proveedor
   caído, la guía pide pasar a modo botón o desactivar el SSO, y con esta condición el túnel dejaba
   de aceptar al owner y nadie podía entrar; MIL-496.)*
6. Solo en `/sign-in/email`: el `email` del cuerpo, recortado y en minúsculas, es el del owner
   (`findOwnerEmail`), igual que en la guarda de la spec 001 (FR-004). El cuerpo se lee de un
   `clone()`, así que la petición original queda intacta.

**Rationale**:
- Las condiciones 3 y 4 hacen que el cambio tenga efecto solo en el mínimo de rutas que pide la
  spec: FR-004, FR-005 y FR-009.
- Las rutas de segundo factor no llevan email. Solo sirven con la cookie firmada `two_factor`,
  que better-auth emite tras un `/sign-in/email` correcto. Por el túnel, ese login solo se acepta
  para el owner (condición 6) en cualquier modo, y las cookies del origen público no se envían al
  origen del túnel, porque el host es otro.
- Cerrar sesión solo afecta a la sesión de quien lo pide.

**Riesgo residual**: una cookie `two_factor` de otro usuario emitida para el origen del túnel
(solo posible si alguien con acceso SSH abrió el túnel e inició sesión con ese usuario antes de
definir la variable) podría completarse por el túnel en los 10 minutos siguientes. Hacen falta a la vez las tres cosas:
- acceso SSH al servidor;
- la contraseña de ese usuario;
- su segundo factor.

Se acepta y se documenta.

## R4. Registro de intentos (FR-007)

**Decision**:
- Cuando el plugin sustituye el origen, añade a la copia la cabecera interna
  `x-oidc-sso-emergency-origin: 1`.
- `onRequest` borra siempre esa cabecera de cualquier petición que llegue de fuera, para que nadie
  pueda falsificarla.
- El hook `after` de `/sign-in/email` de la spec 001 ya registra `emergency_login`. Ahora lee esa
  cabecera y guarda `emergency_origin = true`.
- Los intentos de un usuario que no es el owner desde el origen de emergencia no llegan a la guarda
  (su origen no se sustituye). better-auth los rechaza por origen. Para que queden registrados,
  `onRequest` escribe un evento `emergency_login` / `denied` / `not_owner` con
  `emergency_origin = true` cuando la ruta es `/sign-in/email` y solo falla la condición 6.
- *Enmienda 2026-09-26 (MIL-497):* sin cookies, el router de better-auth no comprueba el origen
  (`validateOrigin` solo fuerza la comprobación con cookies); la hace después el `formCsrfMiddleware`
  del endpoint, ya detrás de los hooks. En SSO-only, ese rechazo llegaba antes a la guarda de la
  spec 001, que lo registraba otra vez sin la marca. Ahora `onRequest` pone la cabecera interna con
  el valor `denied` cuando ya registró el intento, y la guarda no vuelve a registrarlo.

**Rationale**: todos los intentos por el túnel quedan en los eventos del SSO, como pide la
condición 4 de infra.

## R5. Validación del valor

**Decision**: `readEnvOverrides` lee `SSO_OIDC_EMERGENCY_ORIGIN` y lo acepta solo si se cumplen
todas estas condiciones:
- `new URL(value)` no falla;
- el protocolo es `http:` o `https:`;
- `url.origin === value`, sin barra final, ruta, consulta, fragmento ni credenciales;
- no contiene `*`.

Si no cumple, el error se añade a `env.errors`, que ya se escribe en el log al arrancar, y el
valor queda sin definir (FR-002).

**Rationale**: better-auth admite comodines en sus listas de orígenes (`matchesOriginPattern`).
Exigir `url.origin === value` descarta comodines, rutas y formas ambiguas de un solo golpe.

## R6. Dónde se ve la configuración

**Decision**: `oidcSso.get` devuelve `emergencyOrigin: string | null` (solo lectura). La pantalla
de SSO lo muestra en la sección de emergencia con el texto «definido por el entorno». No hay campo
editable, ni en la interfaz ni en la BD (spec, Assumptions).

## R7. Seguridad (ASVS L2, extracto aplicable)

| Control | Cómo se cumple |
|---|---|
| V3.5 / V4.2.2 Protección CSRF | Se mantiene para todo origen distinto del configurado, y para ese origen fuera de las 5 rutas y de los logins que no son del owner |
| V4.1.5 Fallo cerrado | cualquier error en R3 deja la petición intacta |
| V7.1 Registro de eventos de autenticación | R4 |
| V14.5.3 Lista de orígenes permitidos | origen exacto, sin comodines (R5) |

## R8. Rendimiento

- **Sin la variable:** `onRequest` devuelve `undefined` tras comparar un valor en memoria
  (NFR-PERF-001).
- **Con la variable:** las peticiones cuyo `Origin` no coincide salen tras comparar dos textos, sin
  consultas (NFR-PERF-002). Las que coinciden en ruta y origen leen la configuración de la caché y,
  en `/sign-in/email`, el email del owner.
- **Medición:** un `vitest bench` de `onRequest` con y sin la variable.

## R9. Cierre de sesión por el túnel (enmienda 2026-09-26, MIL-495)

**Decision**: el menú de Dokploy cierra sesión con `POST /api/auth/oidc/sign-out`, no con el
`/sign-out` de better-auth. Esa ruta entra en la lista de R2. Cuando la petición trae la cabecera
interna `x-oidc-sso-emergency-origin: 1`, el endpoint borra la sesión y responde `url: "/"` sin
calcular el fin de sesión del proveedor, que en ese escenario está caído.

**Rationale**: con el origen público, el comportamiento no cambia (FR-010 de la spec 001). Por el
túnel, redirigir al proveedor dejaría al owner en una página que no responde.

**Alternatives considered**: cambiar el cliente para que use `/sign-out` por el túnel. Rechazada:
el cliente no sabe si está en el túnel y habría que duplicar la decisión en el navegador.

