<!--
Sync Impact Report
- Version change: 1.1.0 → 1.2.0 (MINOR: principio nuevo y secciones ampliadas)
- Principios añadidos:
  - VII. Identidad humana consolidada: alineado con el principio VIII de la constitución de
    Milpia/mlp-infrastructure (v1.5.8). Keycloak `milpia-infra` como identidad del equipo y «los
    grupos deciden», sin grupos por servicio; OIDC genérico en el código.
- Secciones modificadas:
  - Flujo de desarrollo: formato de PR (título Conventional Commits, cuerpo «Qué cambia / Deploy /
    Verificar / Vuelta atrás», clave Jira en el cuerpo y en los trailers, no en el título), PRs de
    gobernanza y documentación separados del código desplegable.
  - Governance: AGENTS.md como guía canónica para agentes, CLAUDE.md apunta a él; el Sync Impact
    Report se conserva al inicio del archivo; la aprobación formal es el merge del owner.
- Documentos alineados: AGENTS.md (nuevo), CLAUDE.md (apunta a AGENTS.md).
- Pendiente: registrar el Epic maestro propio de mlp-dokploy en `.specify/jira/master-epic.yaml`
  con la primera ejecución de /sdd-sync.
-->
# Milpia Dokploy Constitution

Este repositorio es el fork de Milpia de Dokploy (`Milpia/mlp-dokploy`), basado en la rama
`canary` de upstream. Esta constitución rige las funcionalidades que Milpia añade encima.

## Core Principles

### I. Frontera de licencia con /proprietary (NON-NEGOTIABLE)

- El código bajo cualquier directorio `/proprietary` tiene la licencia DSAL (`LICENSE_PROPRIETARY.md`),
  que no permite usarlo en producción sin un acuerdo comercial con Dokploy.
- Las funcionalidades de Milpia MUST NOT importar, copiar, adaptar, invocar ni desbloquear código,
  esquemas, rutas o componentes que vivan bajo `/proprietary`, ni esquivar los controles de licencia
  enterprise (`enterpriseProcedure`, comprobaciones de licencia, etc.).
- Todo código de Milpia MUST vivir fuera de `/proprietary` y quedar bajo la licencia de la parte
  libre del repositorio (`LICENSE.MD`).
- Si una funcionalidad de Milpia se solapa con una enterprise, la implementación MUST ser
  independiente y MUST ceder el paso a la enterprise cuando la instancia tenga licencia.
- El plan de cada feature MUST declarar explícitamente que ha revisado esta frontera.

Rationale: violar la licencia pone en riesgo legal a Milpia y obliga a reescribir la funcionalidad.

### II. Divergencia mínima con upstream

- Las funcionalidades de Milpia MUST estar desactivadas por defecto. Con ellas desactivadas, el
  comportamiento de Dokploy MUST ser idéntico al de upstream.
- El código de Milpia MUST concentrarse en módulos propios y claramente identificables. Los cambios
  en archivos de upstream MUST limitarse a los puntos de enganche imprescindibles (registrar una
  ruta, montar un componente, añadir una columna).
- Los cambios de esquema de base de datos MUST ser aditivos (tablas o columnas nuevas y opcionales)
  y MUST NOT alterar ni eliminar estructuras de upstream.
- Cada plan MUST listar los archivos de upstream que toca y justificar cada uno.

Rationale: cada línea que diverge de upstream encarece la sincronización con las versiones nuevas
de Dokploy y puede generar conflictos en cada merge desde `canary`.

### III. Seguridad primero en autenticación y secretos

- Los secretos (secretos de cliente, tokens, claves) MUST guardarse cifrados o protegidos, MUST NOT
  aparecer en logs, respuestas de API ni en la interfaz después de guardarse.
- Toda configuración sensible MUST poder inyectarse por variables de entorno, para que el despliegue
  la tome de Vault. Un valor definido por variable de entorno MUST prevalecer sobre la configuración
  guardada.
- Cualquier cambio que pueda impedir el acceso a la instancia (SSO obligatorio, restricciones de
  login) MUST incluir una vía de recuperación documentada y probada.
- Las decisiones de autenticación y autorización MUST fallar de forma cerrada: ante un error o un
  dato ausente se deniega el acceso.
- Los eventos de seguridad relevantes (accesos fallidos, uso de vías de emergencia, cambios de rol)
  MUST quedar registrados con la hora y la identidad implicada.
- Las funcionalidades de autenticación, sesión y control de acceso MUST cumplir los requisitos
  aplicables de OWASP ASVS nivel 2, y las integraciones OAuth 2.0 / OpenID Connect MUST seguir la
  OAuth 2.0 Security Best Current Practice (RFC 9700). El plan MUST incluir la lista de
  comprobación correspondiente.
- Toda entrada externa (parámetros, cabeceras, respuestas de terceros, URLs de redirección) MUST
  validarse contra una lista de valores permitidos antes de usarse.
- Antes del merge, MUST no haber vulnerabilidades altas o críticas conocidas en las dependencias
  nuevas o actualizadas, y los cambios que toquen autenticación, autorización o secretos MUST pasar
  una revisión de seguridad específica (p. ej. `/security-review`) además de la revisión normal.

Rationale: este panel controla todos los despliegues de Milpia; una brecha o un bloqueo en él
afecta a toda la plataforma.

### IV. Calidad y pruebas de los requisitos

- Cada requisito funcional con comportamiento verificable MUST tener al menos una prueba automática
  que lo cubra, y la prueba MUST citar su identificador (`FR-###`) en el nombre o en un comentario.
- En autenticación, autorización y manejo de secretos, las pruebas de los caminos negativos
  (acceso denegado, token inválido, usuario fuera del grupo) MUST escribirse antes que la
  implementación y MUST fallar antes de que exista.
- Las pruebas MUST ejecutarse con la suite existente del repositorio (`pnpm test`) y MUST pasar
  en CI antes del merge.
- Las integraciones con servicios externos (p. ej. Keycloak) MUST probarse contra un doble
  controlado o una instancia efímera, no contra entornos compartidos de Milpia.
- El código nuevo de Milpia MUST alcanzar al menos un 80 % de cobertura de líneas en pruebas
  automáticas, y el código de seguridad (autenticación, autorización, secretos) al menos un 90 %,
  con el 100 % de sus decisiones de acceso cubiertas.
- Cada escenario de aceptación de una user story MUST tener una prueba automática que lo ejercite.
- El código MUST pasar lint, formato y comprobación de tipos sin supresiones nuevas
  (`biome-ignore`, `@ts-ignore`, `any` explícito) salvo justificación escrita en el propio código.
- Los errores MUST mostrarse al usuario con mensajes comprensibles y registrarse con contexto
  suficiente para diagnosticarlos, sin exponer datos sensibles.

Rationale: sin pruebas ligadas a requisitos, la trazabilidad spec → Jira → código se queda en
papel, y sin umbrales la calidad se negocia en cada pull request.

### V. Desarrollo guiado por specs y trazable

- Toda funcionalidad de Milpia MUST pasar por Spec Kit (`/speckit-specify` → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-implement`) y vivir en `specs/###-nombre/`.
- Las specs MUST sincronizarse con Jira mediante las skills `sdd-jira-*`, colgando del Epic
  maestro registrado en `.specify/jira/master-epic.yaml`, y MUST mantener su `traceability.yaml`.
- Los commits que implementan tasks MUST llevar los trailers `Spec:`, `Requirement:`, `Task:` y
  `Jira:` en formato de trailer de git (uno por línea, repetidos si hay varios).
- Los defectos que violen un requisito MUST registrarse con `/sdd-bug`, enlazados al `FR` o `SC`
  que incumplen.

Rationale: permite responder en cualquier momento por qué existe un cambio y qué requisito cubre,
y detectar requisitos sin implementar antes de una release.

### VI. Rendimiento medible

- Cada spec MUST fijar objetivos de rendimiento cuantificados (latencia p95, concurrencia,
  tiempos máximos de espera) para sus caminos críticos, y el plan MUST indicar cómo se miden.
- Una funcionalidad desactivada MUST NOT tener coste apreciable: sin llamadas de red, sin
  consultas adicionales por petición y como máximo 5 ms (p95) añadidos a cualquier respuesta.
- Toda llamada a un servicio externo MUST tener un tiempo máximo de espera explícito y un
  comportamiento definido cuando se supera; MUST NOT bloquear otras peticiones mientras espera.
- Los datos remotos que cambian poco (configuración, metadatos, claves públicas) MUST cachearse
  con una política de invalidación explícita, en lugar de pedirse en cada petición.
- Los objetivos de rendimiento de la spec MUST verificarse con una prueba de carga o medición
  reproducible antes de cerrar la feature, y los resultados MUST adjuntarse al pull request.

Rationale: el panel es la herramienta diaria de despliegue; una regresión de rendimiento la paga
todo el equipo en cada operación, y sin números acordados no se puede detectar.

### VII. Identidad humana consolidada

- Las personas acceden a las instancias que opera Milpia con la identidad de la organización:
  Keycloak, realm `milpia-infra`, alineado con el principio VIII de Milpia/mlp-infrastructure.
- **Los grupos deciden**: el acceso y los roles MUST derivarse de los grupos existentes de la
  organización (`admins`, `leads`, `developers`, `qa`). No se crean grupos por servicio.
- El código MUST implementar estándares (OpenID Connect) y MUST NOT fijar un proveedor, un realm ni
  nombres de grupo. Lo específico de Milpia vive en la configuración (variables de entorno o
  interfaz), para que las funcionalidades sigan siendo válidas para cualquier usuario del fork.
- Las cuentas locales quedan solo como vía de emergencia del owner de la instancia, documentada y
  registrada (principio III).

Rationale: una sola identidad y una sola fuente de verdad para permisos evitan cuentas huérfanas y
accesos que nadie revisa. Mantener el código genérico conserva el valor del fork fuera de Milpia y
reduce la divergencia (principio II).

## Restricciones técnicas

- Stack heredado de upstream: TypeScript, Node.js 24.4 (`.nvmrc`), pnpm workspaces
  (`apps/*`, `packages/*`), Next.js con tRPC en `apps/dokploy`, lógica de servidor en
  `packages/server`, Drizzle como ORM y better-auth para autenticación.
- Las funcionalidades MUST reutilizar el stack y las librerías existentes. Añadir una dependencia
  nueva MUST justificarse en el plan (qué resuelve y por qué no basta lo existente).
- Formato y lint con Biome (`pnpm format-and-lint`); tipado estricto sin errores
  (`pnpm typecheck`).
- Estilo de código según `CLAUDE.md`: comentarios solo para explicar el porqué no evidente, sin
  comentarios que repitan el código ni separadores de sección.

## Flujo de desarrollo

- Las ramas de feature MUST partir de `canary` y volver a `canary` mediante pull request.
- Los mensajes de commit MUST seguir Conventional Commits, más los trailers del principio V.
- Quality gates previos al merge: `pnpm format-and-lint`, `pnpm typecheck` y `pnpm test` en
  verde; umbrales de cobertura del principio IV cumplidos; análisis de dependencias sin
  vulnerabilidades altas o críticas; revisión de al menos una persona; revisión de seguridad si
  aplica el principio III; resultados de rendimiento del principio VI adjuntos; y comprobación
  explícita de los principios I y II.
- Pull requests:
  - título en formato Conventional Commits;
  - cuerpo en español con las secciones «Qué cambia», «Deploy», «Verificar» y «Vuelta atrás»;
  - la clave de Jira va en el cuerpo del PR y en los trailers de los commits, nunca en el título.
- Los cambios de gobernanza, tooling y documentación SHOULD ir en un PR separado del código
  desplegable. Antes de hacer push a una rama que ya tiene PR, MUST comprobarse su estado
  (`gh pr view`).
- `/speckit-analyze` SHOULD ejecutarse antes de `/speckit-implement`, y `/sdd-trace` SHOULD
  ejecutarse antes de cerrar una feature o preparar una release.

## Governance

- Esta constitución prevalece sobre cualquier otra práctica del repositorio para el trabajo de
  Milpia. Donde no diga nada, se siguen `CONTRIBUTING.md` y las convenciones de upstream.
- Enmiendas: se proponen por pull request que modifique este archivo, explicando el motivo y el
  impacto en specs abiertas. Cada enmienda actualiza el Sync Impact Report (comentario HTML al
  inicio del archivo), y la aprobación formal es el merge del owner.
- `AGENTS.md` es la guía canónica para cualquier agente en este repositorio; `CLAUDE.md` apunta a
  ella y solo añade lo específico de Claude Code.
- Versionado semántico: MAJOR si se elimina o redefine un principio de forma incompatible; MINOR si
  se añade un principio o sección o se amplía materialmente; PATCH para aclaraciones y redacción.
- Cumplimiento: cada plan (`/speckit-plan`) MUST incluir la comprobación de esta constitución, y
  cada revisión de pull request MUST verificarla. Cualquier excepción MUST justificarse por escrito
  en el plan, en su sección de seguimiento de complejidad.

**Version**: 1.2.0 | **Ratified**: 2026-09-25 | **Last Amended**: 2026-09-25
