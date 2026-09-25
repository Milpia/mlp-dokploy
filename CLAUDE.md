## Code style
- Don't write comments that restate what the code already says.
- Comment only the "why" when something isn't obvious: workarounds,
  counterintuitive decisions, constraints from an external API.
- No section-divider comments like `// --- Helpers ---`.
- Don't leave comments describing the change you just made.

## Spec-driven development and Jira
- Features follow Spec Kit: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`. Specs live in `specs/<id>-<slug>/`.
- Jira traceability uses the shared skills from `mlp-jira-skills` (installed in `~/.claude/skills/`), through the Atlassian MCP:
  - `/sdd-sync` (`sdd-jira-backlog`): push a full spec to Jira as a Story or Task with Subtasks under the repo's master Epic.
  - `/sdd-issue` (`sdd-jira-issue`): add a single Story, Task or Subtask to an existing backlog.
  - `/sdd-bug` (`sdd-jira-bug`): file a Bug linked to the FR/SC it violates.
  - `/sdd-trace` (`sdd-jira-trace`): requirement coverage, drift and orphan tickets.
- The master Epic key lives in `.specify/jira/master-epic.yaml`; read it, never recreate it.
