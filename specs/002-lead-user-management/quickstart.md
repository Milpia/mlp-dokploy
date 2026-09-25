# Quickstart: validar que los leads no gestionan usuarios

Guía de validación de extremo a extremo. Los contratos están en
[contracts/](./contracts/) y el modelo de datos en [data-model.md](./data-model.md).

## Requisitos previos

- El entorno de la spec 001: Node 24.4.0, `pnpm install` y Docker en marcha.
- Keycloak efímero de la e2e de la spec 001 (`apps/dokploy/__test__/oidc-sso/e2e`), con estos
  usuarios en el realm de prueba:

| Usuario | Grupos | Esperado |
|---|---|---|
| `lead1` | `leads` | admin sin gestión de usuarios |
| `admin1` | `admins` | admin con gestión |
| `admin2` | `admins`, `leads` | admin con gestión (clarify 1) |
| `dev1` | `developers` + grupo de acceso | member |
| owner | ninguno | gestiona siempre |

Configuración:

```dotenv
SSO_OIDC_ACCESS_GROUP=admins,leads,developers
SSO_OIDC_ADMIN_GROUP=admins,leads
SSO_OIDC_USER_MANAGEMENT_GROUP=admins
```

## 1. Pruebas automáticas

```bash
pnpm --filter=dokploy test -- oidc-sso            # unitarias y de integración (PGlite)
KEYCLOAK_E2E=1 pnpm --filter=dokploy test -- oidc-sso/e2e
pnpm --filter=dokploy exec vitest bench oidc-sso   # NFR-PERF-001/002
```

Resultado esperado: todo en verde. La cobertura del módulo queda en ≥ 90 % de líneas, con el 100 %
de las ramas de `decideUserManagement`.

## 2. Escenarios manuales

| # | Pasos | Resultado esperado | Cubre |
|---|---|---|---|
| 1 | `lead1` entra por SSO y despliega un servicio | funciona | US1-1, FR-005 |
| 2 | `lead1` abre Settings › Users | ve la lista, sin acciones ni invitaciones | US1-3, FR-007 |
| 3 | Con la cookie de `lead1`: `POST /api/trpc/user.remove` con el id de `dev1` | 403 `FORBIDDEN`; `dev1` sigue existiendo | US1-2, FR-006 |
| 4 | Con la cookie de `lead1`: `POST /api/auth/organization/update-member-role` con `dev1` → `admin` | 403; el rol de `dev1` no cambia | FR-004, FR-006 |
| 5 | El owner abre la pantalla de SSO › eventos | aparecen los intentos 3 y 4, con acción y usuario afectado | US1-4, FR-012 |
| 6 | `admin1` borra a `dev1` | funciona | US2-1 |
| 7 | `admin2` cambia los permisos de un member | funciona | US2-2 |
| 8 | En la BD, poner `last_sso_login_at` de `admin1` a hace 9 h y reintentar el paso 6 | 403 con «Sign in with SSO again» y aviso en Users | FR-015, FR-007 |
| 9 | Quitar `SSO_OIDC_USER_MANAGEMENT_GROUP` y reiniciar; `lead1` borra a un member | funciona como en upstream | US3-1, FR-009 |
| 10 | Con la variable definida, abrir la pantalla de SSO | el campo aparece bloqueado | US3-2, FR-001 |

## 3. Rendimiento

El bench compara tres casos y adjunta los resultados al pull request (principio VI):
- una petición tRPC que no es de gestión, con la funcionalidad desactivada;
- esa misma petición con la funcionalidad activada (objetivo: ≤ 1 ms p95 añadido);
- una acción de gestión (objetivo: ≤ 20 ms p95 añadidos).
