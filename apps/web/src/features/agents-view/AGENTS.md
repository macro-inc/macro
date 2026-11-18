# Agents workspace

Status: redesigned desktop and phone lists; composer and session header migration remains.

## What it is

The Agents workspace owns conversation navigation, the agent roster, and new-chat composition. Transcript and runtime behavior belong to `features/block-agent`.

## Start here

- `views/AgentsView.tsx`: production query, selection, draft, and navigation ownership.
- `phone-list.tsx`: phone list, archive, header menu, favorites, bubbles, and existing entity actions.
- `core/phone-list.ts`: waiting/favorite partition and startable agent selection.
- `primitives/mobile-agent-request.ts`: selection handoff to the mounted accessory composer.
- `views/agents-sidebar/agents-sidebar.tsx`: redesigned desktop list composition.
- `views/archived-conversations/archived-conversations.tsx`: archived conversations in the main pane.
- `core/conversation-list.ts` and `primitives/conversation-list-view.ts`: sorting, waiting partition, and user-scoped preferences.
- `views/shared/conversation-row/`: new row composition; shared status/code presentation is under `components/`.
- `core/model-selection.ts` and `components/unified-model-selector/`: advertised tier labels and shared selector state/trigger; `views/model-selector/` composes its desktop menu and phone sheet.

## Boundaries

- Keep original agent/model/effort/speed pickers for unrelated consumers; new-chat and Agents running sessions share selector behavior without moving their preference or session mutations.
- Keep `components/AgentsSidebar.tsx`, `AgentSessionRow.tsx`, and `views/AgentSessionListItem.tsx` for reference and Home consumers.
- Preserve Home row geometry and activity rendering when extracting shared behavior.
- Reuse Soup entity actions and session archive mutations; do not add another action or cache path.
- Fetch PR metadata only for an open preview, never eagerly for every conversation row.
- Keep unsupported remote metadata absent; archived counts describe loaded pages.
- Keep the `connections` page routable even though the redesigned navigation omits it.
- Preserve `agents-conversation-list-view-v1` filters when changing sort; legacy grouping does not determine the redesigned list.
- Follow Root-and-parts composition and the [frontend feature architecture](../../../../../docs/architecture/frontend-features.md).

## Checks

From `apps/web`:

- `bun run test --project app src/features/agents-view`
- `bun run test --project app src/lib/i18n`
- `bun run type-check`

From the repository root, run `just check`. Exercise the sidebar, archive actions, PR/branch previews, and unchanged Home/phone consumers before release.

## Related

- [AI chat walkthrough](../../../../../docs/agent-guide/ai-chat.md)
- [Web guide](../../../AGENTS.md)

Keep session names and agent-bubble labels at the normal list-row weight on desktop and phone, including archive, preview, and header surfaces; unread uses a dot, never heavier text.
