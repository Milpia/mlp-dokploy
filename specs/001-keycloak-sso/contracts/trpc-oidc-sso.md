# Contrato: router tRPC `oidcSso`

Se registra en `apps/dokploy/server/api/root.ts`. Todos los procedimientos salvo `publicConfig` son
**solo para el owner de la instancia**: `ctx.user.id` debe ser el de la membresía de owner más
antigua. No basta con `ctx.user.role === "owner"`, que es el rol en la organización activa: un admin
puede crear su propia organización y ser owner de ella (hallazgo de la revisión de seguridad).
Cualquier otro usuario recibe `FORBIDDEN`. En cloud, todas devuelven
`NOT_FOUND`.

## `publicConfig` (public query)

Lo usan la página de login y el menú de usuario. No hace llamadas al proveedor y lee de la caché.

```ts
output: { mode: "disabled" | "button" | "sso-only"; buttonLabel: string }
```

`mode` es el efectivo: vale `disabled` si `active = false`.

## `get` (owner query)

```ts
output: {
  mode, issuerUrl, clientId, accessGroup, adminGroup, groupsClaim, extraScopes, buttonLabel, allowInsecureHttp,
  hasClientSecret: boolean,              // FR-015: nunca se devuelve el secreto
  callbackUrl: string,                   // para registrarla en el proveedor
  verified: boolean,                     // verifiedIssuer === issuerUrl && owner vinculado
  active: boolean, inactiveReason?: "disabled" | "incomplete" | "enterprise" | "cloud",
  sources: Record<Field, "env" | "db">,  // FR-020
}
```

## `update` (owner mutation)

```ts
input: {
  issuerUrl?: string (url), clientId?: string, clientSecret?: string,   // vacío = no se cambia
  accessGroup?: string | null, adminGroup?: string | null,   // listas separadas por comas
  groupsClaim?: string, extraScopes?: string,              // vacío = "groups" / sin scopes extra
  buttonLabel?: string (1..64), allowInsecureHttp?: boolean,
  mode?: "disabled" | "button" | "sso-only",
}
```

**Errores**:
- `BAD_REQUEST`: se intenta cambiar un campo que viene de una variable de entorno.
- `BAD_REQUEST`: `http:` sin `allowInsecureHttp`.
- `BAD_REQUEST`: scopes adicionales con caracteres no válidos (RFC 6749 §3.3).
- `PRECONDITION_FAILED`: se pasa a `button` o `sso-only` con la configuración incompleta.
- `PRECONDITION_FAILED`: se pasa a `sso-only` sin verificar (FR-011).
- `PRECONDITION_FAILED`: se cambia `issuerUrl` estando en `sso-only`.

**Efectos**: invalida la caché y registra un evento `config_change` o `mode_change`.

## `testConnection` (owner mutation)

```ts
input: Partial<config> // valores sin guardar; si falta alguno, se usa el guardado
output: { ok: true, issuer: string } | { ok: false, code: TestFailure, message: string }
TestFailure = "invalid_url" | "insecure_http" | "unreachable" | "timeout"
            | "not_oidc" | "issuer_mismatch" | "invalid_client"
```

- Hace el discovery.
- Después intercambia un código inventado (`dokploy-connection-test`) en el token endpoint. El
  servidor autentica al cliente antes de mirar el código (RFC 6749 §4.1.3):
  - `invalid_client`, `unauthorized_client` o 401 → client ID o secreto incorrectos;
  - `invalid_grant` → credenciales válidas.
  No se usa `client_credentials` porque, sin *service accounts*, Keycloak responde
  `unauthorized_client` tanto con el secreto bueno como con el malo (hallado por el e2e).

## `listEvents` (owner query)

```ts
input: { limit?: number (1..100, default 50) }
output: Array<{ createdAt, type, outcome, reason?, email?, correlationId }>
```
