# agent-permissions

## What it is

The web side of agent permissions: per agent, what its code-mode programs may
call. Each action (Read, Create, Edit, Send, Delete) has a default (Allow ·
Ask · Deny) and per-entity exceptions (an entity is a registry group); saved
rules on single tools are listed and removable. Shown inline under an agent's
row in Settings → Agents (its Permissions button), in the agent editor's
Permissions section, and reached from chat by `requestAgentPermissions`. The
server resolves every state; the web only picks what to show and builds the
changes.

## Start here

- `core/model.ts`: display order, visible pairs, exceptions, counts, change
  builders (pure, tested).
- `components/tool-permissions.tsx`: the Tool permissions table;
  `action-accordion.tsx`, `exception-row.tsx`, `entity-picker.tsx`,
  `permission-state-menu.tsx`, `tool-settings-list.tsx` are its parts.
- `views/agent-permissions-panel.tsx`: loads, saves (`permission-changes.ts`),
  Reset, notes; what `Agents.tsx` renders.
- `queries/permissions.ts`: catalog, per-agent and per-session queries,
  set/reset mutations (a save re-reads every session view). A 404 (feature
  off for the caller) reads as `null`: hide the UI.
- Chat: `components/gated-operation-list.tsx` and
  `blocked-by-permissions-card.tsx` (held or refused operations),
  `views/show-permissions-card.tsx` (the ShowPermissions card),
  `views/open-agent-permissions.ts` (opens Settings → Agents beside the chat
  with the row expanded). `block-agent` wires them into the transcript.

## Scope

- Owns: the Tool permissions component and panel, and the chat's blocked and
  ShowPermissions cards. `features/settings/Agents.tsx` owns the rows and the
  Permissions button.
- Not here: the registry of operations → `crates/agent_permission_registry`;
  the API, resolution and tighten-only rules → `crates/agent_permissions`
  (agent harness `/agent-tool-permissions`, `/agents/{id}/tool-permissions`).

## Gotchas

- Wire names stay `always`/`ask`/`never` and `update`/`destroy`; only labels
  say Allow/Ask/Deny, Edit, Delete (`components/labels.ts`).
- A default set to Allow sends `null` (no saved default is Allow). In the
  settings an exception keeps any state, even one equal to the default; `Use
  default (X)` sends `null`. In the chat cards, setting a group's action to
  its action's default sends `null` (`changeForAction`), and a tool set to
  its action's state sends `null` (`PendingChanges.setTool`).
- The view's states are the server's: an exception the agent set on itself
  only adds to the default (the stricter wins), so show `state`, never
  recompute it from `rules`.
- Count and show only visible pairs: an exception or tool rule counts when its
  entity has a tool for its action (`ruleVisible`). Rules on hidden pairs
  stay saved; Reset clears them too.
- The Macro persona's permissions use `MACRO_NEW_BOT_ID`, not
  `MACRO_AGENT_BOT_ID` (the row id).
- Gate every entry point, and every read of the permissions API, on
  `useAgentPermissionsFlag` (`enable-agent-permissions`, the one flag: the
  harness offers JS tools programs, which permissions gate, on it alone; on
  only in local stacks, PostHog elsewhere) and on the API not answering 404
  (`useAgentPermissionsAvailable`). Off, the chat's ShowPermissions card is a
  plain row, the blocked card has no link, and a pending approval stays
  answerable without one. Every surface and its flag-off test:
  `crates/agent_permissions/AGENTS.md` (Rollout: one flag).
- Copy says plainly what the settings cover: every program the agent runs,
  whose operations the harness checks before it runs (with the flag on, a
  program reaches Macro only that way; its TypeScript module has no network
  at all). Its other tools and connected apps are not covered, even on
  Deny; never word it so a person could think they are.
- Color is on glyphs only (Ask amber hand, Deny failure prohibit); text stays
  ink.

## Checks

- `bun run test -- src/features/agent-permissions src/features/settings/Agents.test.tsx`
- `bunx playwright test --config src/features/block-agent/browser-test/permissions.playwright.config.ts`
  (chat cards, `?language=js_tools`, and the settings component,
  `?view=page`)

## Related

- Rules: `.agents/rules/web/` · Walkthroughs: `docs/agent-guide/settings.md`
  (Agent permissions), `docs/agent-guide/ai-chat.md` (Agent permissions in a
  session)
