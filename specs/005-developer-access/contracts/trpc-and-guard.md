# Contrato: tRPC y guarda de caducidad

## `oidcSso.update` (owner) · campo nuevo

```ts
input: { ...lo de hoy, groupProfiles?: string | null }   // JSON de contracts/env.md, ≤ 16 384
```

- **JSON inválido:** `BAD_REQUEST` con el motivo de validación (FR-009), por ejemplo `groupProfiles.developers.permissions[0]: unknown permission "canDeploy"`.
- **Campo fijado por el entorno:** `env_locked`, igual que los demás campos.
- **Cambio guardado:** evento `config_change` con `groupProfiles` en la lista de campos (FR-012).

`oidcSso.get` devuelve `groupProfiles` con su origen (`env` o `db`).

## `oidcSso.groupProfilesCheck` (owner) · query nueva

```ts
output: {
  groups: Array<{
    group: string;
    missingProjects: string[];      // nombres que no coinciden con ningún proyecto
    ambiguousProjects: string[];    // nombres que coinciden con más de uno
    projectsResolved: number;
  }>;
}
```

No registra eventos. La pantalla de SSO la muestra bajo el campo de perfiles.

## `oidcSso.memberProfiles` (owner y admin) · query nueva

```ts
output: Record<userId, { groups: string[]; appliedAt: string; expired: boolean }>
```

La usan `show-users.tsx` (insignia «SSO: developers») y `add-permissions.tsx` (aviso de que un cambio
manual se perderá en el siguiente login por SSO, FR-011).

## `oidcSso.memberProfileStatus` (cualquier sesión) · query nueva

```ts
output: { managed: boolean; groups: string[]; expiresAt: string | null; expired: boolean }
```

Si `expired`, la página de proyectos muestra un aviso con «Sign in with SSO» (FR-017).

## Guarda `memberProfileGuard` (middleware tRPC)

Se encadena en `protectedProcedure`, después de `userManagementGuard`. Orden de salidas:

1. Si `ctx.user.role !== "member"`: `next()`, sin leer nada.
2. Si el usuario no está en la caché de usuarios con perfil: `next()`.
3. Si hay fila y no está caducada, y `last_sso_login_at + 8 h > now`: `next()`.
4. Si ha caducado:
   1. en una transacción, pone los 11 permisos a `false`, vacía las listas y guarda `expired_at = now`;
   2. registra el evento `member_profile`/`denied`/`profile_expired` con `user_id`;
   3. hace `next()`: la petición sigue y upstream la evalúa ya sin permisos.
5. Ante cualquier excepción: `FORBIDDEN` con `Your access expired. Sign in with SSO again.` y un evento `member_profile`/`error`. Nunca deja pasar con permisos de más (NFR-SEC-001).

Una prueba de deriva comprueba que `memberProfileGuard` está en la cadena de middlewares de
`protectedProcedure`.

## Login (`provisionIdentity`)

Dentro de la transacción de hoy, después de `ensureMembership` y `recordLoginState`:

```text
applyGroupProfile({ userId, organizationId, finalRole, groups, profiles, now })
```

La tabla de decisión está en research.md (R3). Si lanza una excepción, la transacción se deshace, el
login termina en `sso_unavailable` y se registra un evento `sso_login`/`error`/`profile_failed`.
