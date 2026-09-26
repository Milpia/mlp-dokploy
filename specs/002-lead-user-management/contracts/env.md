# Contrato: variable de entorno

| Variable | Formato | Ejemplo | Efecto |
|---|---|---|---|
| `SSO_OIDC_USER_MANAGEMENT_GROUP` | texto o lista separada por comas, ≤ 512 caracteres | `admins` | Solo el owner y los usuarios de este grupo, con un login por SSO en las últimas 8 h, pueden gestionar usuarios. Sin definir (y sin valor guardado) no cambia nada |

Si está definida:
- Prevalece sobre el valor guardado.
- Aparece bloqueada en la pantalla de SSO.
- Un valor vacío o solo espacios cuenta como no definida. Esto es igual que en
  `SSO_OIDC_ADMIN_GROUP`.

Configuración de Milpia (lab y prod, spec 014 de infra):

```dotenv
SSO_OIDC_ACCESS_GROUP=admins,leads
SSO_OIDC_ADMIN_GROUP=admins,leads
SSO_OIDC_USER_MANAGEMENT_GROUP=admins
```
