# Quickstart: validar el acceso de developers por grupo

## Requisitos previos

- Rama `005-developer-access` con `pnpm install` hecho.
- Para los escenarios manuales, el Keycloak de la e2e de la spec 001 (o el del lab) con los usuarios `admin1` (`admins`), `lead1` (`leads`), `dev1` y `dev2` (`developers`) y `nogroup1` (en el grupo de acceso, sin perfil).
- Proyectos `alpha` (entornos `production` y `staging`), `beta` (`production` y `staging`) y `gamma` (`production`).
- Configuración:

```dotenv
SSO_OIDC_ACCESS_GROUP=admins,leads,developers
SSO_OIDC_ADMIN_GROUP=admins,leads
SSO_OIDC_GROUP_PROFILES={"developers":{"permissions":[],"projects":["alpha","beta"],"environments":{"exclude":["production"]}}}
```

## 1. Pruebas automáticas

```bash
pnpm --filter=dokploy exec vitest run --config __test__/vitest.config.ts __test__/oidc-sso
pnpm typecheck
```

Deben cubrir:
- la validación de `groupProfiles`, con un caso por regla de FR-009;
- la tabla de R3;
- la unión de varios grupos;
- la resolución de nombres contra PGlite;
- la guarda, en sus cinco salidas;
- la prueba de deriva de `protectedProcedure`.

## 2. Escenarios manuales

| # | Pasos | Resultado esperado | Cubre |
|---|---|---|---|
| 1 | `dev1` entra por SSO por primera vez | ve `alpha` y `beta` con su entorno `staging`; no ve `gamma` ni ningún `production` | US1-1, US1-3, FR-016 |
| 2 | `dev1` despliega un servicio de `alpha/staging` y cambia una variable de entorno | funciona | US1-2, SC-001 |
| 3 | `dev1` intenta crear un proyecto, un servicio y un entorno, y abrir Docker, Traefik, SSH keys y proveedores Git (interfaz y llamada directa con su cookie) | todo se rechaza | US2, SC-002 |
| 4 | Con la cookie de `dev1`, operar un servicio de `gamma` por su id | rechazo | US2-3 |
| 5 | Como admin, abrir Settings › Users | `dev1` muestra «SSO: developers»; sus permisos avisan de que un cambio manual se perderá | US3-3, FR-011 |
| 6 | Un admin da a mano `canAccessToDocker` a `dev1`, y `dev1` vuelve a entrar por SSO | el permiso manual desaparece | FR-003 |
| 7 | Quitar a `dev2` de `developers` en Keycloak; `dev2` vuelve a entrar | no ve ningún proyecto | US4-1, SC-003 |
| 8 | Poner `last_sso_login_at` de `dev1` a hace 9 h y recargar el panel | no ve proyectos, aparece el aviso de volver a entrar y un evento `profile_expired`; tras entrar por SSO recupera `alpha` y `beta` | US4-4, FR-017 |
| 9 | Pasar `dev1` a `leads` y que vuelva a entrar | entra como admin y la insignia «SSO: developers» desaparece | US4-2, FR-007 |
| 10 | `nogroup1`, con permisos manuales, entra por SSO | sus permisos no cambian | US5-2, FR-005 |
| 11 | Poner `SSO_OIDC_GROUP_PROFILES` con `"canDeploy"` y reiniciar | la pantalla de SSO muestra el error, los perfiles no se aplican y el login sigue funcionando | FR-009 |
| 12 | Añadir `"delta"` (no existe) a la lista y abrir la pantalla de SSO | «delta» aparece como proyecto no encontrado | R5 |
| 13 | Quitar la variable y reiniciar; `nogroup1` y un member con permisos manuales entran | nada cambia | US5-1, SC-004 |

## 3. Rendimiento

- **Login (NFR-PERF-001):** `vitest bench` de `applyGroupProfile` con 200 proyectos y 500 servicios: p95 ≤ 50 ms.
- **Guarda (NFR-PERF-002):** bench de `memberProfileGuard`:
  - admin y member sin perfil: sin consultas;
  - member con perfil: p95 ≤ 5 ms.
