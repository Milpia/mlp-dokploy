# Quickstart: validar la solo lectura por entorno

## Requisitos previos

- Rama `006-read-only-access` con `pnpm install` hecho.
- Para los escenarios manuales, el Keycloak de la e2e de la spec 001 (o el del lab) con estos usuarios:
  - `admin1` (`admins`);
  - `dev1` (`developers`);
  - `qa1` (`qa`);
  - `devqa1` (`developers` y `qa`);
  - `nogroup1` (en el grupo de acceso, sin perfil).
- Proyecto `milpia` con los entornos `production` y `staging`. Cada uno con:
  - una aplicación con variables de entorno y un dominio;
  - un Postgres con un backup configurado.
- Configuración (contracts/env.md):

```dotenv
SSO_OIDC_ACCESS_GROUP=admins,developers,qa
SSO_OIDC_ADMIN_GROUP=admins
SSO_OIDC_GROUP_PROFILES={"developers":{"permissions":[],"projects":["milpia"],"readOnly":["production"]},"qa":{"permissions":[],"projects":["milpia"],"environments":{"exclude":["production"]},"readOnly":true}}
```

## 1. Pruebas automáticas

```bash
pnpm --filter=dokploy exec vitest run --config __test__/vitest.config.ts __test__/oidc-sso
pnpm typecheck
```

Deben cubrir:
- la validación de `readOnly`, con un caso por regla de FR-014;
- la tabla de verdad de la unión (FR-007);
- cada regla de `READ_ONLY_POLICY`, contra PGlite para `lookup`;
- las cinco salidas de la guarda;
- `redact`, con objetos anidados de solo lectura y completos en la misma respuesta;
- los WebSocket: terminal en solo lectura, contenedor ajeno en terminal y logs, inspección que falla, log de despliegue fuera del alcance o con perfil caducado, y terminal del servidor;
- las pruebas de deriva:
  - la cadena de `protectedProcedure`;
  - toda mutación y suscripción tiene regla;
  - toda columna secreta está clasificada.

## 2. Escenarios manuales

| # | Pasos | Resultado esperado | Cubre |
|---|---|---|---|
| 1 | `qa1` entra por SSO por primera vez | ve `milpia/staging` con estado, logs, monitorización e historial de despliegues, y la insignia «Solo lectura»; no ve `production` | US1-1, US4-1, SC-001 |
| 2 | `qa1` abre las variables de la aplicación de staging | ve los nombres con `••••••••` como valor; el botón de guardar está desactivado | FR-006, FR-010 |
| 3 | Con la cookie de `qa1`, llamar a `application.deploy`, `application.saveEnvironment`, `domain.create`, `mounts.create`, `backup.create`, `schedule.create` y `application.stop` sobre staging | todas devuelven `FORBIDDEN` con `This environment is read-only for you.`, y hay un evento `read_only` por cada una | US1-2, US1-3, US3-1, SC-002 |
| 4 | Repetir el paso 3 con una clave de API de `qa1` (`x-api-key`, `/api/application.deploy`) | igual | US3-1, FR-005 |
| 5 | `qa1` abre la terminal del contenedor de staging | se rechaza; los logs del contenedor sí se ven | US1-4, US3-2, FR-004 |
| 6 | `qa1` abre la lista de backups del Postgres de staging | ve fecha, resultado y tamaño; restaurar y ejecutar se rechazan; `backup.one` devuelve la contraseña enmascarada | FR-006a |
| 7 | `dev1` abre la aplicación de `production` | ve estado, logs e historial; variables enmascaradas; `refreshToken` enmascarado | US2-1 |
| 8 | `dev1` intenta desplegar y cambiar una variable en `production` | rechazo | US2-2 |
| 9 | `dev1` despliega en `staging`, en la misma sesión, y ve los valores de sus variables | funciona | US2-3, SC-003 |
| 10 | `dev1` intenta cambiar las variables del proyecto `milpia` (`project.update`) y abre el proyecto | rechazo: llegan a producción; ve los nombres de las variables del proyecto sin valores | FR-003a, US2-4 |
| 11 | Comprobar que la terminal y los logs de un contenedor solo se abren desde el servicio al que pertenece (pasos en el repositorio privado, MIL-545) | se rechaza cualquier otro caso | FR-004b, US3-4 |
| 12 | `dev1` abre la terminal del contenedor de staging con su propio `serviceId` | funciona | R7 |
| 12b | Comprobar que los logs de despliegue en directo solo se ven para servicios del alcance y con el perfil vigente (pasos en el repositorio privado, MIL-546) | se rechaza fuera del alcance o con el perfil caducado; los de staging se ven | FR-004c, US3-5 |
| 12c | `dev1` intenta abrir la terminal del servidor y reiniciar un contenedor desde la vista de Docker | los dos se rechazan | FR-004a, US3-6 |
| 12d | `qa1` abre la pestaña de volúmenes de un servicio con un archivo montado | ve la ruta y el tipo, con el contenido enmascarado | FR-006 |
| 13 | `devqa1` entra por SSO | staging con acceso completo (lo da `developers`) y producción en solo lectura | FR-007 |
| 14 | Poner `last_sso_login_at` de `qa1` a hace 9 h y recargar | pierde el acceso como en la 005 | US3-3, FR-008 |
| 15 | Cambiar `readOnly` de `developers` a `["prodution"]` (errata) y abrir la pantalla de SSO | aviso «prodution» en entornos de solo lectura no encontrados | R8 |
| 16 | Poner en `qa` `"readOnly":["production"]` (excluido de su alcance) y reiniciar | la pantalla de SSO muestra el error, los perfiles no se aplican y el login sigue funcionando | FR-014 |
| 17 | Quitar `readOnly` de ambos perfiles y reiniciar; `dev1` entra | despliega en su alcance como en la 005 | US5-1, FR-012, SC-004 |
| 18 | `admin1` y `nogroup1` entran | nada cambia | FR-009 |

## 3. Rendimiento

```bash
pnpm --filter=dokploy exec vitest bench --config __test__/vitest.config.ts __test__/oidc-sso/performance.test.ts
```

Bloque `performance · read-only (spec 006)` (research R12):
- **Owner, admin, member sin perfil y member sin solo lectura:** 0 lecturas de base de datos.
- **Mutación con regla directa:** ≤ 1 ms p95.
- **Mutación con `lookup`:** ≤ 5 ms p95.
- **`redact` sobre la respuesta de `project.all`**, con 200 proyectos y 500 servicios: ≤ 5 ms p95.

Los resultados se adjuntan al PR (principio VI).

## 4. Al activarlo en el lab y en producción

1. Desplegar la imagen con la spec en el lab y aplicar la configuración de arriba.
2. Ejecutar los escenarios 1 a 13 (incluidos 12b a 12d).
3. Si `developers` ya tenían acceso a producción antes de activar `readOnly`, rotar los `refreshToken` de los servicios de producción y, si el owner lo considera necesario, sus contraseñas (research R6-a).
4. Solo entonces infra añade `qa` a `SSO_OIDC_ACCESS_GROUP` y a `deploy_access_groups`.

## Vuelta atrás

Quitar `readOnly` de `SSO_OIDC_GROUP_PROFILES` y reiniciar. Los cambios se aplican en el siguiente
login por SSO de cada usuario, o como mucho a las 8 h. Mientras tanto, los usuarios afectados siguen
en solo lectura, que es el lado seguro. Antes de quitarlo, sacar `qa` del grupo de acceso: sin
`readOnly`, su perfil daría acceso completo.
