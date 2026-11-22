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
- `queries/permissions.ts`: catalog, per-agent and per-session queries,
  set/reset mutations (a save re-reads every session view). A 404 (feature
  off for the caller) reads as `null`: hide the UI.
- Chat: `components/gated-operation-list.tsx` and
  `blocked-by-permissions-card.tsx` (held or refused operations),
  `views/show-permissions-card.tsx` (the ShowPermissions card, same rows and
  saving as the page), `views/open-agent-permissions.ts` (opens the page beside
  the chat). `block-agent` wires them into the transcript.

## Scope

- Owns: the permissions page, the editor's Permissions section, the list,
  and the chat's blocked and ShowPermissions cards.
- Not here: the registry of operations → `crates/agent_permission_registry`;
  the API, resolution and tighten-only rules → `crates/agent_permissions`
  (agent harness `/agent-tool-permissions`, `/agents/{id}/tool-permissions`).

## Gotchas

- Setting a tool to its action's state sends `state: null`, so a saved tool
  rule always means the tool differs; ↺ sends `null` too. While the action's
  own change saves, the tool's waits for it (`PendingChanges.setTool`) and
  compares with the state the action ends up in, so a failed action save
  can't leave the tool following the wrong state.
- The Macro persona's permissions use `MACRO_NEW_BOT_ID`, not
  `MACRO_AGENT_BOT_ID`.
- Gate every entry point, and every read of the permissions API, on
  `useAgentPermissionsFlag` (`enable-agent-permissions`, the one flag: the
  harness offers JS tools programs, which permissions gate, on it alone; on
  only in local stacks, PostHog elsewhere) and on the API not answering 404.
  Off, the chat's ShowPermissions card is a plain row, the blocked card has
  no link, and a pending approval stays answerable without one. Every
  surface and its flag-off test: `crates/agent_permissions/AGENTS.md`
  (Rollout: one flag).
- Copy says plainly what the settings cover: the agent's JS tools programs,
  which the harness checks before they run. Its plain JavaScript
  programs, other tools and connected apps are not covered, even on Never;
  never word it so a person could think they are.
- Color is on glyphs only (Ask amber hand, Never failure prohibit); text stays
  ink. Control labels are short; full state names live in tooltips and prose.

## Checks

- `bun run test -- src/features/agent-permissions src/features/settings/Agents.test.tsx`
- `bunx playwright test --config src/features/block-agent/browser-test/permissions.playwright.config.ts`
  (chat cards for both languages, `?language=js_tools`, and the page,
  `?view=page`)

## Related

- Rules: `.agents/rules/web/` · Walkthroughs: `docs/agent-guide/settings.md`
  (Agent permissions), `docs/agent-guide/ai-chat.md` (Agent permissions in a
  session)
