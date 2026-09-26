# Data Model: Compatibilidad verificada con siete proveedores OIDC

No hay cambios en la base de datos. Las entidades son archivos del repositorio.

## Resultado de verificación: `results/<provider>.json`

Un archivo por proveedor, que la última ejecución sobrescribe (research R6). Lo escribe el runner y no se edita a mano.

```text
VerificationResult {
  schema: "oidc-compat/v1"
  provider: ProviderId
  providerVersion: string          // p. ej. "26.7.4"; SaaS: "saas" + fecha de ejecución
  moduleCommit: string             // SHA de Dokploy con el que se verificó
  ranAt: string                    // ISO 8601, UTC
  environment: "local" | "ci"
  status: "passed" | "failed" | "skipped"
  skippedReason?: string           // solo si status = skipped (p. ej. faltan OKTA_E2E_ORG_URL, OKTA_E2E_API_TOKEN)
  scenarios: Record<ScenarioId, "passed" | "failed" | "not-applicable" | "pending">
  failures?: { scenario: ScenarioId, message: string }[]   // sin secretos ni tokens (FR-008)
}

ProviderId = "keycloak" | "okta" | "auth0" | "authentik" | "zitadel" | "fusionauth" | "authelia"

ScenarioId =
  | "login-provisioning"     // alta en el grupo de acceso
  | "admin-role"             // admin por el grupo de administración, member para el resto
  | "access-denied"          // fuera del grupo de acceso
  | "role-change"            // cambio de rol en el siguiente login
  | "sign-out"               // SSO-only: fin de sesión en el proveedor o pantalla de «sesión cerrada»
  | "connection-test-ok"     // secreto correcto → conexión correcta
  | "connection-test-bad"    // secreto incorrecto → nunca «conexión correcta» (FR-011)
  | "user-management-group"  // spec 002; "pending" hasta que se implemente
```

Reglas:
- `status = passed` solo si ningún escenario tiene `failed`.
- `not-applicable` solo se permite en `sign-out` cuando el proveedor no tiene `end_session_endpoint`. En ese caso el escenario comprueba la pantalla de «sesión cerrada», así que en la matriz aparece como «pasa (sin fin de sesión en el proveedor)».

## Limitaciones conocidas: `limitations.md`

Se escribe a mano. Tiene una sección por proveedor, con las limitaciones y su motivo (p. ej. «Authelia: sin RP-initiated logout, issue #5057»). El generador de la matriz lo incorpora tal cual.

## Matriz: `compatibility.md`

La genera `pnpm run e2e:oidc:matrix` a partir de `results/*.json` y `limitations.md`:
- una fila por proveedor, en el orden de `ProviderId`;
- una columna por escenario, más la versión, la fecha y el entorno;
- un proveedor sin archivo de resultados aparece como «no verificado».

## Conductor de proveedor: `providers/<id>/driver.ts`

```text
ProviderDriver {
  id: ProviderId
  kind: "self-hosted" | "saas"
  requiredEnv: string[]                  // SaaS: variables sin las que se omite
  moduleConfig(): {                       // lo que el owner pondría en la pantalla de SSO
    issuerUrl, clientId, clientSecret, groupsClaim, extraScopes,
    accessGroup, adminGroup, allowInsecureHttp
  }
  users: Record<"member" | "admin" | "outsider" | "manager", { username, password, email }>
  moveUser(role, toGroup): Promise<void>  // para "role-change": API del proveedor o semilla alternativa
  login(page, user): Promise<void>        // completa el login del proveedor en el navegador
}
```
