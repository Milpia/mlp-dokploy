# AGENTS.md

Instrucciones para cualquier agente de IA (Claude Code, Cursor, Aider, Copilot, etc.) que trabaje en este repositorio.

> Este archivo son las reglas **operativas** del repo. Los **principios** que las justifican (frontera de licencia con `/proprietary`, divergencia mínima con upstream, seguridad, calidad, trazabilidad, rendimiento, identidad consolidada) están en [`.specify/memory/constitution.md`](.specify/memory/constitution.md). Ante cualquier duda o conflicto, ese documento tiene prioridad.

> Si usas **Claude Code**, lee también [`CLAUDE.md`](CLAUDE.md): el orden de consulta con graphify y context-mode, qué skill `sdd-jira-*` usar en cada caso y el estilo de código de upstream. Las reglas de los dos archivos se complementan.

## Qué es este repositorio

`Milpia/mlp-dokploy` es el **fork de Milpia de [Dokploy](https://github.com/Dokploy/dokploy)**, el PaaS con el que se despliegan los microservicios de Milpia. Sigue la rama `canary` de upstream y añade encima funcionalidades propias de Milpia, siempre desactivadas por defecto y fuera de `/proprietary` (constitución, principios I y II).

La infraestructura que lo despliega vive en `Milpia/mlp-infrastructure`, y la CLI de despliegue en `Milpia/mlp-deploy-cli`. Hoy la infraestructura usa la imagen oficial de Dokploy (spec 013 de infra, R12): pasar a una imagen construida desde este fork es una decisión del owner y una spec propia en infra.

## Stack

- Monorepo **pnpm** (`apps/*`, `packages/*`), **TypeScript**, **Node.js 24.4** (`.nvmrc`).
- `apps/dokploy`: **Next.js** (pages router, servidor propio) con **tRPC**.
- `packages/server`: lógica de servidor, **Drizzle ORM** (PostgreSQL) y **better-auth**.
- Pruebas con **Vitest** (`apps/dokploy/__test__`), lint y formato con **Biome**.
- Verificación contra proveedores OIDC reales (spec 004): `pnpm --filter=dokploy run e2e:oidc <proveedor|all>` levanta el proveedor en Docker, ejecuta la batería común con Chromium (`playwright-core`) y escribe `specs/004-oidc-provider-compatibility/results/`. `e2e:oidc:matrix` regenera la matriz. Okta y Auth0 solo corren con las variables de sus tenants de prueba; nunca contra entornos de Milpia.
- Migraciones en `apps/dokploy/drizzle/`, generadas con `pnpm --filter=dokploy run migration:generate`. Solo aditivas (principio II).

## Flujo de Git

1. **Rama por cambio** desde `canary` recién actualizado (`git switch canary && git pull --ff-only`). Nombres: `<NNN>-<slug>` para specs de Spec Kit, `chore/<slug>` o `docs/<slug>` para gobernanza y documentación, `hotfix/<slug>` para urgencias.
2. Commits en [Conventional Commits](https://www.conventionalcommits.org/), en inglés, con los trailers de trazabilidad (`Spec:`, `Requirement:`, `Task:`, `Jira:`).
3. **Pull Request a `canary`**, revisado y mergeado por el owner. **Nunca** push directo a `canary` ni a `main`.
4. Antes de hacer push a una rama que ya tiene PR, comprueba su estado con `gh pr view` (el owner mergea rápido).
5. La gobernanza, el tooling y la documentación van en un PR separado del código desplegable.

### Formato del PR

- **Título**: Conventional Commits (`feat(oidc-sso): ...`, `docs(001): ...`), **sin** la clave de Jira.
- **Cuerpo, en español**: «Qué cambia», «Deploy» (qué hay que hacer al desplegar: migraciones, variables), «Verificar» (comandos y resultado esperado) y «Vuelta atrás». La clave de Jira va en el cuerpo.

### Checklist del PR que trae una versión de upstream

- [ ] **Orden y numeración de migraciones.** El fork se basa en un tag publicado de upstream, y las migraciones de Milpia van justo detrás de su última (hoy, `0196_chief_goliath` detrás de la `0195` de `v0.30.7`). Cada versión nueva de upstream traerá sus propias migraciones con esos mismos números. En el PR de sincronización:
  1. Las de upstream conservan su número y su posición. Las de Milpia se mueven detrás: se renombran el `.sql` y el snapshot al número siguiente, y se actualiza su entrada en `apps/dokploy/drizzle/meta/_journal.json`.
  2. El SQL de una migración de Milpia que ya se haya aplicado en algún entorno **no cambia de contenido**. Se hace idempotente (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), porque al moverla se ejecutará de nuevo.
  3. Drizzle aplica solo las migraciones cuya fecha (`when`) es posterior a la última aplicada, y salta las demás **en silencio**. Toda migración nueva de upstream tiene que tener un `when` posterior al de la última migración de Milpia aplicada en prod. Si no lo tiene, se sube su `when` en el journal, manteniendo el orden, y se anota en el PR.
  4. Se comprueba el resultado aplicando todas las migraciones sobre una copia de la base de datos de prod o del laboratorio antes del merge.
- [ ] **Workflows nuevos o cambiados** en `.github/workflows/`. Los que publican en el Docker Hub de Dokploy o usan sus secretos se desactivan en el fork, con `gh workflow disable "<nombre>"`. La imagen de Milpia solo la publica `milpia-image.yml`.
- [ ] La suite de `oidc-sso` y `pnpm typecheck` pasan sobre el resultado del merge.
- [ ] `pnpm --filter=dokploy run e2e:oidc all` pasa sobre el resultado del merge, y la matriz regenerada (`e2e:oidc:matrix`) va en el PR. Si un proveedor falla por su propia versión y no por la de upstream, se anota en `specs/004-oidc-provider-compatibility/limitations.md`.

## Reglas de trabajo: restricciones

Se aplican siempre, salvo que el owner autorice explícitamente lo contrario en la conversación:

- **Nunca** importes, copies, adaptes ni desbloquees código bajo `/proprietary` (licencia DSAL; constitución, principio I).
- **Nunca** hagas push directo a `canary` ni a `main`, ni fuerces un push sobre ellas.
- **Nunca** pongas secretos en el código, los commits ni el chat. Si encuentras uno hardcodeado, **repórtalo y espera aprobación** antes de tocarlo.
- **Nunca** crees ni modifiques issues en Jira sin mostrar antes el borrador al owner.
- Cambios en archivos de upstream: solo los puntos de enganche imprescindibles, y cada uno justificado en el plan de la spec (principio II).
- Antes de ejecutar migraciones contra una base de datos que no sea local, pregunta.

## Convenciones

- Código nuevo de Milpia en módulos propios e identificables (p. ej. `packages/server/src/oidc-sso/`), con subrutas `@dokploy/server/<módulo>` en vez del barrel de upstream.
- Todo lo específico de Milpia (realm, grupos, dominios) va en configuración, nunca en el código (constitución, principio VII).
- Las pruebas citan el requisito que cubren (`it("FR-007: ...")`). Umbrales de cobertura: constitución, principio IV.
- Comentarios: solo el porqué no evidente (ver `CLAUDE.md`, «Code style»).

## Dónde buscar más contexto

- `specs/<NNN>-<slug>/`: cada funcionalidad, con `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `tasks.md`, `quickstart.md`, `traceability.yaml` y, si la hay, una guía de operación (`operations.md`).
- La **guía compartida entre sesiones** (brief) de Milpia, en Claude Docs: decisiones que cruzan repos, el contrato entre infra, la CLI y Dokploy, las preferencias del owner y el estado de cada repo.
- Para decisiones que cruzan repos, cita el repo, la spec y el SHA (p. ej. «infra 013 R12 en `cb107e2`»).

## Spec Kit (herramienta de SDD)

Este repo usa [Spec Kit](https://github.com/github/spec-kit): la constitución vive en `.specify/memory/constitution.md`, las specs en `specs/<NNN>-<slug>/` y los skills en `.claude/skills/speckit-*`.

Flujo: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/sdd-sync` → `/speckit-implement`. Ningún skill se salta las reglas de este archivo.

## Trazabilidad en Jira (SDD ↔ Jira)

- Jira Cloud `pabelandino.atlassian.net`, proyecto **MIL**. Este repo tiene su **propio Epic maestro**, con la clave en `.specify/jira/master-epic.yaml`. Se crea una sola vez, en la primera sincronización, y nunca se recrea.
- Cada spec se sincroniza como **Story o Task** según su tamaño (regla de `sdd-jira-backlog`), con **Subtasks** trazables a su `FR-###` o `SC-###`. Cada defecto es un **Bug** enlazado al requisito que viola.
- **Antes de implementar una spec nueva**, sincroniza su backlog para que el ticket exista desde el primer commit.
- Una pieza que surge a mitad de sprint se añade primero a `spec.md`/`tasks.md` y después a Jira.
- `specs/<NNN>-<slug>/traceability.yaml` es la fuente de verdad del mapeo local ↔ Jira. Se reescribe entero desde la skill, nunca a mano.
- Las decisiones que cruzan repos se enlazan también en Jira (p. ej. «implementa» o «relaciona» con la Story de infra).
- El contrato compartido (labels, mapeo, bloque de trazabilidad) vive en [`Milpia/mlp-jira-skills`](https://github.com/Milpia/mlp-jira-skills), carpeta `skills/_sdd-jira-shared/`.
