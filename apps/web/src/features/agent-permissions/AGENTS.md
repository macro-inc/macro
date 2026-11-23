# agent-permissions

## What it is

The web side of agent permissions: per agent, what its code-mode programs may
call. Each action (Read, Create, Edit, Send, Delete) has a default (Allow ·
Ask · Never, a compact segmented control) and per-entity exceptions (an entity is a registry group); saved
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
  Reset, notes; what `Agents.tsx` renders. A following agent shows its
  source (`components/following-note.tsx`) and the component read-only, with
  its own restrictions marked and removable.
- `views/agent-permissions-form.tsx`: the agent form's Permissions tabs.
  `NewAgentPermissions` keeps a draft (follow a picked policy, or own
  permissions over the source's) that `applyPermissionsDraft` saves once
  the agent exists; `EditAgentPermissions` sets the source (confirming when
  the agent had its own) or uses its own (`detach`) at once.
- `views/team-permissions-panel.tsx`: a team's default permissions (the
  Team default permissions row in Settings → Agents), saved through
  `queries/team.ts` (`/agent-tool-permissions/teams/{id}`); team admins and
  owners edit, members read. Saving re-reads every following agent's view.
  `views/permission-changes.ts` `usePolicyChanges` saves either policy.
- `core/references.ts`: draft application, default candidate, follower
  exceptions (pure, tested).
- `queries/references.ts`: source candidates, policy previews, set source
  and detach (a detach sends its changes only when there are some: the route
  takes between 1 and 200).
- `queries/permissions.ts`: catalog, per-agent and per-session queries,
  set/reset mutations (a save re-reads every session view). A 404 (feature
  off for the caller) reads as `null`: hide the UI.
- Chat: `components/gated-phrases.ts` (what held or refused operations would
  do, as a phrase, a row title, or the request card's sentence with its
  verbs and entities marked; the words per entity and action are in
  `gated-thing-phrases.ts`), `components/gated-operation-list.tsx` and
  `blocked-by-permissions-card.tsx` (refused operations),
  `views/show-permissions-card.tsx` (the ShowPermissions card),
  `views/open-agent-permissions.ts` (opens Settings → Agents beside the chat
  with the row expanded). `block-agent` wires them into the transcript.

## Scope

- Owns: the Tool permissions component and panel, and the chat's blocked and
  ShowPermissions cards. `features/settings/Agents.tsx` owns the rows and the
  Permissions button.
- Not here: the registry of operations → `crates/agent_permission_registry`;
  the API, resolution and tighten-only rules → `crates/agent_permissions`
  (agent harness `/agent-tool-permissions`, `/agents/{id}/tool-permissions`,
  and for following another agent's permissions `.../source`, `.../detach`,
  `/agent-tool-permissions/sources`, `/agent-tool-permissions/policies/{id}`
  and a team's default at `/agent-tool-permissions/teams/{id}`;
  a following view carries `source` and `inherited`).

## Gotchas

- Wire names stay `always`/`ask`/`never` and `update`/`destroy`; only labels
  say Allow/Ask/Never, Edit, Delete (`components/labels.ts`).
- A default set to Allow sends `null` (no saved default is Allow). In the
  settings and the chat cards an exception keeps any state, even one equal
  to the default (`changeForException`); `Use default (X)` (the row's ✕)
  sends `null`. A tool set to its action's state sends `null`
  (`PendingChanges.setTool`).
- The view's states are the server's: an exception the agent set on itself
  only adds to the default (the stricter wins), so show `state`, never
  recompute it from `rules`.
- Count and show only visible pairs: an exception or tool rule counts when its
  entity has a tool for its action (`ruleVisible`). Rules on hidden pairs
  stay saved; Reset clears them too.
- A save to any agent re-reads every other agent's view and every policy
  preview (`storeView`): agents following it resolve through it.
- A new agent's form preselects its scope's default (personal Macro for a
  private agent, the team default for a team agent), and creating it always
  sends `PUT .../source` for the chosen policy (then `detach` for own
  permissions): it ends up following what the form showed, whatever the
  server assigned at creation.
- The Macro persona's permissions use `MACRO_NEW_BOT_ID`, not
  `MACRO_AGENT_BOT_ID` (the row id).
- Gate every entry point, and every read of the permissions API, on
  `useAgentPermissionsFlag` (`enable-agent-permissions`, the one flag: the
  harness offers JS tools programs, which permissions gate, on it alone; on
  only in local stacks, PostHog elsewhere) and on the API not answering 404
  (`useAgentPermissionsAvailable`). Off, the chat's ShowPermissions card is a
  plain row, the blocked card has no link, and a pending approval stays
  answerable without Edit permissions. Every surface and its flag-off test:
  `crates/agent_permissions/AGENTS.md` (Rollout: one flag).
- Copy says plainly what the settings cover: every program the agent runs,
  whose operations the harness checks before it runs (with the flag on, a
  program reaches Macro only that way; its TypeScript module has no network
  at all). Its other tools and connected apps are not covered, even on
  Never; never word it so a person could think they are.
- Every registry group needs an entity phrase in `gated-thing-phrases.ts`
  (and a pair phrase where its verb would misname the tools):
  `gated-phrases.test.ts` reads `registry.json` and fails on a pair it
  doesn't list.
- Color is on glyphs only (Ask amber hand, Never failure prohibit); text stays
  ink. The one exception is the pending request's sentence (block-agent's
  `PermissionRequestCard`), which accents each action and entity; the agent's
  name stays plain.

## Checks

- `bun run test -- src/features/agent-permissions src/features/settings/Agents.test.tsx`
- `bunx playwright test --config src/features/block-agent/browser-test/permissions.playwright.config.ts`
  (chat cards, `?language=js_tools`, and the settings component,
  `?view=page`)

## Related

- Rules: `.agents/rules/web/` · Walkthroughs: `docs/agent-guide/settings.md`
  (Agent permissions), `docs/agent-guide/ai-chat.md` (Agent permissions in a
  session)
