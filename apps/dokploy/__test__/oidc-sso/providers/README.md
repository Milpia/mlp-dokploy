# Verificación de proveedores OIDC (spec 004)

La batería de `battery.e2e.test.ts` comprueba el módulo `oidc-sso` contra un proveedor real. La
matriz de resultados está en `specs/004-oidc-provider-compatibility/compatibility.md`.

## Cómo se ejecuta

Una vez, instala el navegador:

```bash
pnpm --filter=dokploy exec playwright-core install chromium
```

Después, un proveedor o todos:

```bash
pnpm --filter=dokploy run e2e:oidc keycloak
pnpm --filter=dokploy run e2e:oidc all
pnpm --filter=dokploy run e2e:oidc:matrix   # regenera la matriz
```

El runner (`apps/dokploy/scripts/oidc-providers.ts`):
1. levanta el entorno del proveedor con `docker compose`, si es autoalojable;
2. ejecuta la batería;
3. escribe `specs/004-oidc-provider-compatibility/results/<id>.json`;
4. destruye el entorno con `docker compose down -v`, pase o falle.

La batería no forma parte de `pnpm test`: sin `OIDC_E2E_PROVIDER` se omite.

## Los secretos de estos directorios son de prueba

Los secretos de cliente, las contraseñas, los tokens de arranque y las claves que hay en
`providers/<id>/` son **valores fijos de prueba**:
- solo sirven para contenedores efímeros que escuchan únicamente en `127.0.0.1`;
- esos contenedores se destruyen al terminar cada ejecución;
- no protegen nada real y no deben usarse fuera de estas pruebas.

## Okta y Auth0: solo por variables de entorno

Okta y Auth0 no se pueden levantar en local. Se verifican contra tenants de desarrollo creados
**solo para pruebas**, sin usuarios ni datos reales, y nunca contra entornos de Milpia.

Sus credenciales viven únicamente en variables de entorno (ver
`specs/004-oidc-provider-compatibility/contracts/runner-and-env.md`):
- nunca se escriben en el repositorio, en GitHub ni en los archivos de resultados;
- el runner las redacta de cualquier mensaje que guarde;
- sin ellas, el proveedor se omite y el runner dice qué variables faltan.
