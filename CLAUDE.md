## Repository rules

This repo also has an `AGENTS.md` at the root with the rules for any AI agent (licensing boundary with `/proprietary`, git flow against `canary`, PR format, secrets, Jira traceability). Read it too: it applies to Claude Code as well.

## Code style
- Don't write comments that restate what the code already says.
- Comment only the "why" when something isn't obvious: workarounds,
  counterintuitive decisions, constraints from an external API.
- No section-divider comments like `// --- Helpers ---`.
- Don't leave comments describing the change you just made.

## Lookup order: graphify and context-mode before raw output
1. **graphify**: when `graphify-out/graph.json` exists, start code and architecture questions with `graphify query`, `graphify path` or `graphify explain`. After code-only changes, `graphify update .` is enough.
2. **context-mode**: filter, count or summarise long outputs (test runs, logs, large files) with `ctx_execute` / `ctx_batch_execute` / `ctx_execute_file` instead of dumping them into the conversation.
3. Read files or raw command output only when 1 and 2 do not cover the case. Commands that change state (git, pnpm install, migrations) use Bash directly.

## Spec-driven development and Jira
- Features follow Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/sdd-sync` → `/speckit-implement`. Specs live in `specs/<id>-<slug>/`.
- Jira traceability uses the shared skills from [`Milpia/mlp-jira-skills`](https://github.com/Milpia/mlp-jira-skills) (installed in `~/.claude/skills/`) through the Atlassian MCP:

| Situation | Skill |
|---|---|
| Sync a whole spec after `/speckit-tasks` (Story or Task with Subtasks under the repo's master Epic) | `/sdd-sync` (`sdd-jira-backlog`) |
| Add a single Story, Task or Subtask to an existing backlog | `/sdd-issue` (`sdd-jira-issue`) |
| Record a defect linked to the FR/SC it violates | `/sdd-bug` (`sdd-jira-bug`) |
| Audit coverage, drift or why a ticket exists | `/sdd-trace` (`sdd-jira-trace`) |

- The skills read the shared contract in `~/.claude/skills/_sdd-jira-shared/` first; don't restate it.
- The master Epic key lives in `.specify/jira/master-epic.yaml`; read it, never recreate it.
- Show the owner every Jira draft before creating or editing issues.
