# Contrato: guarda de gestión de usuarios

Una sola política (`decideUserManagement`, research R4) aplicada en dos puntos de control. Los dos
deniegan con el mismo código y registran el mismo evento.

## Respuesta de denegación

| Superficie | Error | Mensaje |
|---|---|---|
| tRPC | `TRPCError { code: "FORBIDDEN" }` | según `reason`, ver abajo |
| better-auth (`/api/auth/*`) | `APIError("FORBIDDEN")`, HTTP 403 | igual |

| `reason` | Mensaje |
|---|---|
| `not_in_group` | `You are not allowed to manage users.` |
| `no_sso_login` | `Sign in with SSO to manage users.` |
| `grant_expired` | `Your permission to manage users expired. Sign in with SSO again.` |
| `check_failed` | `You are not allowed to manage users.` (el detalle va solo al log del servidor) |

Los mensajes no revelan el nombre del grupo configurado.

## Efectos de una denegación

- No se modifica nada: la guarda se ejecuta antes que el handler.
- Se registra un evento en `oidc_sso_auth_event` (data-model.md):
  - `type = "user_management"`, `outcome = "denied"`, `reason`;
  - `action` es la `UserManagementAction` del path;
  - `user_id` es quien lo intentó;
  - `target_user_id` es el usuario afectado, resuelto solo al denegar:
    - `userId` del input, tal cual;
    - `memberId` (tRPC) → el `userId` de ese miembro;
    - `memberIdOrEmail` (`/organization/remove-member`) → el `userId` del miembro con ese id o,
      si no existe, del usuario con ese email;
    - en invitaciones nuevas, definiciones de roles o si no se resuelve, `null`.
    Un fallo al resolverlo no cambia la denegación: el evento se guarda con `null`;
  - `ip`.
- Si falla la escritura del evento, la acción se deniega igualmente. El fallo va a `console.error`.

## Punto 1: middleware tRPC

Las tres rutas `customRole.*` se añadieron al implementar (T014): la prueba de deriva las detectó como mutaciones de definiciones de roles (FR-004). Solo se comprueba su ruta; el router vive en `/proprietary` y no se importa.

Se encadena en `protectedProcedure` y en `enterpriseProcedure` (`apps/dokploy/server/api/trpc.ts`). `enterpriseProcedure` no deriva de `protectedProcedure` y sirve las rutas `customRole.*`; la revisión de seguridad (T029) detectó que sin ese segundo enganche la guarda no las cubría. La prueba de deriva comprueba que cada ruta de la tabla lleva la guarda en su cadena de middlewares.

| Path tRPC | `UserManagementAction` |
|---|---|
| `user.remove` | `remove_user` |
| `user.assignPermissions` | `change_permissions` |
| `user.createUserWithCredentials` | `create_user` |
| `user.sendInvitation` | `resend_invitation` |
| `organization.inviteMember` | `invite` |
| `organization.removeInvitation` | `cancel_invitation` |
| `organization.updateMemberRole` | `change_role` |
| `customRole.create` | `manage_roles` |
| `customRole.update` | `manage_roles` |
| `customRole.remove` | `manage_roles` |

Para cualquier otro path, la guarda llama a `next()` sin leer configuración ni BD.

## Punto 2: hook `before` del plugin `oidcSso()`

| Ruta (`POST /api/auth…`) | `UserManagementAction` |
|---|---|
| `/organization/remove-member` | `remove_member` |
| `/organization/update-member-role` | `change_role` |
| `/organization/invite-member` | `invite` |
| `/organization/cancel-invitation` | `cancel_invitation` |
| `/organization/create-role` | `manage_roles` |
| `/organization/update-role` | `manage_roles` |
| `/organization/delete-role` | `manage_roles` |

Sin sesión, el hook no hace nada: better-auth ya responde 401 en esas rutas.

## Query tRPC `oidcSso.userManagementStatus`

Es `protectedProcedure` y la puede llamar cualquier usuario con sesión. No registra eventos.

```ts
output: {
  canManageUsers: boolean;
  reason: null | "not_in_group" | "no_sso_login" | "grant_expired" | "check_failed";
  expiresAt: string | null; // ISO; solo con canManageUsers y grupo configurado
}
```

`canManageUsers: true` con `reason: null` cuando la funcionalidad está inactiva (FR-009). La
interfaz sigue aplicando además sus comprobaciones de rol de upstream.

## Cambios en `oidcSso.get` y `oidcSso.update`

- `get` añade `userManagementGroup: string | null`, y `sources.userManagementGroup` vale
  `"env" | "db"`.
- `update` acepta `userManagementGroup?: string | null`.
  - Si el valor viene del entorno → `BAD_REQUEST`, como el resto de campos.
  - Guardar registra `config_change` e invalida la caché.
