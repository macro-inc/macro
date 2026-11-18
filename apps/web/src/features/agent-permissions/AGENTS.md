# agent-permissions

## What it is

The web side of agent permissions: per agent, what its code-mode programs may
call, as Allow · Ask · Never per group and action (create, read, update,
delete, send), with per-tool overrides. Opened from Settings → Agents (the
editor's Permissions section, Macro's shield button, or
`requestAgentPermissions`). The server resolves every state; the web only
shows a tool's override or its action's state.

## Start here

- `core/model.ts`: changes, group summaries, search, counts (pure, tested).
- `views/agent-permissions-page.tsx`: the page, its states and Reset.
- `views/agent-permissions-list.tsx`: the group rows; reusable in chat cards.
- `queries/permissions.ts`: catalog and per-agent queries, set/reset
  mutations. A 404 (feature off for the caller) reads as `null`: hide the UI.

## Scope

- Owns: the permissions page, the editor's Permissions section, the list.
- Not here: the registry of operations → `crates/agent_permission_registry`;
  the API, resolution and tighten-only rules → `crates/agent_permissions`
  (agent harness `/agent-tool-permissions`, `/agents/{id}/tool-permissions`).

## Gotchas

- Setting a tool to its action's state sends `state: null`, so a saved tool
  rule always means the tool differs; ↺ sends `null` too.
- The Macro persona's permissions use `MACRO_NEW_BOT_ID`, not
  `MACRO_AGENT_BOT_ID`.
- Gate every entry point on `useAgentPermissionsFlag` (both
  `enable-agent-permissions` and `enable-ocaml-code-mode`) and on the API not
  answering 404.
- Color is on glyphs only (Ask amber hand, Never failure prohibit); text stays
  ink. Control labels are short; full state names live in tooltips and prose.

## Checks

- `bun run test -- src/features/agent-permissions src/features/settings/Agents.test.tsx`

## Related

- Rules: `.agents/rules/web/` · Walkthrough: `docs/agent-guide/settings.md` (Agent permissions)
