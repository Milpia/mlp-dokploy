# Research: Los leads operan como admin pero no gestionan usuarios

Decisiones de la fase 0. Cada una sigue el formato Decision / Rationale / Alternatives.
El mapa de vías de gestión de usuarios (R1) se levantó leyendo el código de `canary` en
`3730c89` y el de better-auth 1.6.23 en `node_modules`; no se leyó nada bajo `/proprietary`.

## R1. Vías por las que un admin gestiona a otros usuarios

**Decision**: la restricción cubre dos superficies, cada una con un único punto de control.

tRPC (todas derivan de `protectedProcedure`, `apps/dokploy/server/api/trpc.ts:161`):

| Procedimiento | Archivo | Acción (FR-004) |
|---|---|---|
| `user.remove` | `routers/user.ts:392` | borrar usuario |
| `user.assignPermissions` | `routers/user.ts:461` | cambiar permisos |
| `user.createUserWithCredentials` | `routers/user.ts:698` | crear usuario con credenciales |
| `user.sendInvitation` | `routers/user.ts:736` | reenviar invitación |
| `organization.inviteMember` | `routers/organization.ts:300` | invitar |
| `organization.removeInvitation` | `routers/organization.ts:424` | cancelar invitación |
| `organization.updateMemberRole` | `routers/organization.ts:459` | cambiar rol |

HTTP de better-auth (plugin `organization`, abiertas a cualquier `admin` porque el rol estático
`admin` de `packages/server/src/lib/access-control.ts:127` tiene `member:*`, `invitation:*` y
`ac:*`):

| Ruta | Acción (FR-004) |
|---|---|
| `/organization/remove-member` | quitar de la organización |
| `/organization/update-member-role` | cambiar rol |
| `/organization/invite-member` | invitar |
| `/organization/cancel-invitation` | cancelar invitación |
| `/organization/create-role`, `/update-role`, `/delete-role` | definiciones de roles |

Quedan fuera:
- `/admin/*` del plugin `admin`: en self-hosted no lo alcanza un admin de organización, porque
  exige `user.role = "admin"` y Dokploy nunca lo escribe.
- `user.revokeSession`: upstream ya lo reserva al owner.
- Lecturas (`user.all`, `organization.allInvitations`, `/organization/list-members`): FR-007 exige
  mantener visible la lista.

**Rationale**: las rutas HTTP de better-auth no pasan por tRPC. Si solo se protegiera tRPC, un lead
podría hacer lo mismo con una petición directa a `/api/auth/organization/*`, que FR-004 y FR-006
prohíben.

**Alternatives considered**:
- Proteger solo la interfaz: incumple FR-006.
- Desactivar las rutas de better-auth con `disabledPaths`: cambia el comportamiento de upstream
  para todos, incluido el owner, y rompe la interfaz de cloud que usa `removeMember`.

## R2. Punto de control en tRPC

**Decision**: un middleware `userManagementGuard` que se encadena una vez en `protectedProcedure`.
Mira `path` contra la lista cerrada de R1. Si el path no está en la lista, llama a `next()` sin
leer nada. Si está, aplica la política de R4.

**Rationale**:
- Es un único punto de enganche en upstream (dos líneas en `trpc.ts`, principio II).
- Cubre también `withPermission(...)`, que se construye sobre `protectedProcedure`.
- Cubre las llamadas con API key, porque `validateRequest` rellena `ctx.user` igual que con
  sesión.

**Alternatives considered**:
- Una línea de comprobación en cada uno de los 7 procedimientos: siete puntos de divergencia, y
  un procedimiento nuevo de upstream quedaría abierto sin que nada avise.
- Envolver `withPermission("member", …)`: no cubre `user.remove`, que usa `protectedProcedure`
  sin permiso declarado.

**Riesgo de deriva**: si upstream renombra o añade un procedimiento de gestión, la lista queda
desfasada. Mitigación: una prueba recorre `appRouter` y falla si:
- un path de la lista ya no existe;
- aparece un procedimiento nuevo cuyo nombre encaja con
  `/(member|invit|role|permission|user)/i` y no está clasificado. Una lista de revisados declara
  cuáles no son de gestión.

## R3. Punto de control en las rutas de better-auth

**Decision**: un hook `before` del plugin `oidcSso()` con `matcher` sobre los paths de R1. Obtiene
la sesión con `getSessionFromCtx` y aplica la misma política de R4. Si la política deniega, lanza
`APIError("FORBIDDEN")`.

**Rationale**: vive en nuestro plugin, que ya está registrado en `auth.ts`, así que no suma
divergencia con upstream. El plugin ya usa hooks `before` para la guarda de SSO-only.

**Alternatives considered**: `organizationHooks.beforeRemoveMember` y compañía obligarían a tocar
la llamada `organization({...})` en `auth.ts`, y no existen hooks para las rutas de roles.

## R4. Política de decisión

**Decision**: función pura `decideUserManagement` en
`packages/server/src/oidc-sso/domain/user-management.ts`. Reglas en orden:

1. SSO inactivo (desactivado, incompleto, licencia enterprise o cloud) → `allow` (FR-009).
2. Grupo de gestión sin configurar → `allow` (FR-009).
3. El usuario es el owner de la instancia (`instanceOwnerId()`) → `allow` (FR-010).
4. No hay constancia de grupos de ese usuario → `deny: no_sso_login` (FR-014).
5. La constancia tiene más de 8 horas → `deny: grant_expired` (FR-015).
6. Sus grupos no coinciden con el grupo de gestión (`isInGroup`) → `deny: not_in_group` (FR-003).
7. En cualquier otro caso → `allow`. Siguen aplicándose las reglas de upstream (FR-011).

Cualquier excepción al leer la configuración o la constancia → `deny: check_failed`
(NFR-SEC-001).

**Rationale**:
- La regla se aplica igual a `admin` y a `member`. Un `member` ya no tiene esos permisos en
  upstream, así que el resultado final no cambia, y no hace falta mirar el rol, que puede cambiar
  a mitad de sesión.
- El owner queda exento por identidad, no por rol. Es la misma decisión que tomó el
  `ownerProcedure` de la spec 001 tras la revisión de seguridad.

**Alternatives considered**: guardar un booleano `canManageUsers` en el login. Se descarta porque
US3 escenario 3 pide evaluar contra la configuración vigente: si el owner cambia el grupo, el
booleano quedaría obsoleto hasta el siguiente login.

## R5. Constancia de grupos

**Decision**: tabla nueva `oidc_sso_login_state`, con una fila por usuario: grupos normalizados y
fecha del último login por SSO. Se escribe dentro de la transacción de provisioning de la spec 001,
en cada login correcto que no sea del owner.

Límites de los grupos: se guardan como máximo 100, de 256 caracteres como máximo cada uno. Si un
proveedor envía más, se guardan los 100 primeros tras ordenarlos. Esto evita filas desmesuradas;
un grupo que quede fuera se trata como ausente, lo que falla en cerrado.

**Rationale**: una lectura por clave primaria por cada acción de gestión cumple NFR-PERF-002 con
margen.

**Alternatives considered**:
- Guardar los grupos en la sesión: better-auth no ofrece campos propios en la sesión sin tocar su
  esquema en `auth.ts`.
- Añadir columnas a `member` o `user`: altera estructuras de upstream (principio II).

## R6. Caducidad de 8 horas

**Decision**: constante `USER_MANAGEMENT_GRANT_TTL_MS = 8 h` en el dominio, no configurable.

**Rationale**: la decidió el owner en el clarify. Hacerla configurable añade una variable, una
columna y validación sin ningún caso de uso pedido (YAGNI). Si hiciera falta, pasaría a ser un
ajuste más de `oidc_sso_config`.

**Alternatives considered**: variable `SSO_OIDC_USER_MANAGEMENT_TTL`, pospuesta.

## R7. Registro de intentos rechazados

**Decision**: cada denegación escribe un evento en `oidc_sso_auth_event`. Tiene
`type = "user_management"`, `outcome = "denied"` y `reason` con el código de R4. La acción y el
usuario afectado van en dos columnas nuevas y opcionales: `action` y `target_user_id`. Los eventos
aparecen en la tabla de eventos que el owner ya consulta en la pantalla de SSO.

**Rationale**: el helper `audit()` de upstream escribe con `createAuditLog`, que vive en
`/proprietary`. Invocarlo desde código de Milpia rompería el principio I. Nuestra tabla de eventos
ya existe, tiene retención y ya se muestra al owner.

**Alternatives considered**: `audit(ctx, { metadata: { denied: true } })`, descartada por el
principio I.

## R8. Interfaz

**Decision**:
- Nueva query tRPC `oidcSso.userManagementStatus` → `{ canManageUsers, reason }`.
- `components/dashboard/settings/users/show-users.tsx` la combina con sus comprobaciones actuales
  para ocultar las acciones.
- `pages/dashboard/settings/users.tsx` la usa para ocultar `ShowInvitations` y mostrar el aviso de
  caducidad (FR-007).

**Rationale**: son los dos únicos componentes que muestran acciones de gestión. Los diálogos que
cuelgan de ellos (`change-role`, `add-permissions`, `add-invitation`) desaparecen con su
disparador.

**Alternatives considered**: recortar `member:*` en `user.getPermissions`. Cambiaría la
semántica de permisos que usa el resto de upstream y no cubre `show-users.tsx`, que decide por rol.

## R9. Configuración

**Decision**:
- Columna `user_management_group` en `oidc_sso_config` y variable
  `SSO_OIDC_USER_MANAGEMENT_GROUP`.
- Misma precedencia, validación y bloqueo en la interfaz que `adminGroup` (FR-001).
- Mismo formato de lista separada por comas (FR-002).

**Rationale**: la configuración reutiliza toda la maquinaria de la spec 001: caché, invalidación
al guardar, campos bloqueados por el entorno.

## R10. Hallazgos de upstream fuera de alcance

Durante R1 aparecieron defectos de upstream que esta spec no corrige (principio II). Se reportan
aparte:
- Un admin puede usar `/organization/remove-member` y `/update-member-role` sobre otros admins o
  sobre sí mismo, saltándose las reglas de `user.ts:445` y `organization.ts:502`. Con esta spec,
  eso queda cerrado para quien no está en el grupo de gestión, pero no para los admins del grupo.
- `user.remove` borra la fila global del usuario, no solo su pertenencia a la organización.
- `user.createUserWithCredentials` no valida el nombre del rol y no audita.
- `user.sendInvitation` no comprueba que la invitación sea de la organización del que llama.

## R11. Seguridad (ASVS L2, extracto aplicable)

| Control | Cómo se cumple |
|---|---|
| V4.1.1 Control de acceso en el servidor | guardas en tRPC y en better-auth (R2, R3). La interfaz solo oculta |
| V4.1.3 Mínimo privilegio | lista de permitidos (clarify 1) |
| V4.1.5 Fallo cerrado | reglas 4–6 y `check_failed` (R4, NFR-SEC-001) |
| V4.2.1 Sin referencias directas inseguras | las guardas deniegan antes de leer el objetivo |
| V7.2.2 Registro de fallos de autorización | R7 |
| V3.3 Reautenticación para funciones sensibles | caducidad de 8 horas (R6) |

## R12. Rendimiento

- **Sin grupo configurado o con el SSO inactivo:** la guarda lee la configuración desde la caché
  en memoria de la spec 001, sin consulta a la BD (NFR-PERF-001). Solo lo hace cuando el path está
  en la lista.
- **Con grupo configurado, en paths de gestión:** dos consultas en paralelo, una por clave primaria a
  `oidc_sso_login_state` y la de `instanceOwnerId()`, que ya usa el router de la spec 001
  (NFR-PERF-002).
- **Medición:** un `vitest bench` compara la guarda en paths que no son de gestión con y sin la
  funcionalidad, y en paths de gestión con PGlite.
