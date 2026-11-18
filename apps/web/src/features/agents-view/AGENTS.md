# Agents workspace

Status: redesigned desktop/phone lists, shared model selection, phone composer, and phone session header.

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
- `core/model-selection.ts`, `primitives/model-selector-navigation.ts`, and `model-selector.tsx`: shared selector logic and platform entry; trigger parts live under `views/shared/`.
- `views/agent-model-picker.tsx`: model-only adapter for universal-input AI drafts and routine targets; does not add unsupported effort or speed settings.
- `views/shared/code-details-drawer/`: common phone PR/branch drawer for rows and the session header.
- `queries/session-code-details.ts`: bounded session-ID/owner lookup for cold header code identity.
- `../block-agent/views/mobile/redesigned-session-header/`: normal-weight session title, code details, Info, and retained action owners.
- `components/mobile-composer/`: phone Root, editor, controls, attachment and send parts; `ChatComposer` retains shared editor behavior.
- `primitives/composer-expansion.ts`: focus/blur and open-sheet expansion state.
- Phone attachment chips reuse `Input.Attachments appearance="chips"`; Home and session composers retain the default previews.

## Boundaries

- Use the unified selector for Home, new chats, inline and standalone sessions, universal-input AI drafts, and routine agent/model targets; keep old picker components unwired for reference and preserve each host's preference and mutation ownership.
- Keep `components/AgentsSidebar.tsx`, `AgentSessionRow.tsx`, and `views/AgentSessionListItem.tsx` for reference and Home consumers.
- Preserve Home row geometry and activity rendering when extracting shared behavior.
- Reuse Soup entity actions and session archive mutations; do not add another action or cache path.
- Fetch PR metadata only for an open preview, never eagerly for every conversation row.
- Keep unsupported remote metadata absent; archived counts describe loaded pages.
- Keep the `connections` page routable even though the redesigned navigation omits it.
- Preserve `agents-conversation-list-view-v1` filters when changing sort; legacy grouping does not determine the redesigned list.
- Partition desktop rows once: Waiting on you first, flagged Open PRs second, Conversations last; share filters and sort, and fill paging from unpinned Conversations.
- Render desktop row ages as pointer-transparent hover/focus overlays using the row's hover or active surface; never let the age change title truncation or appear on phone rows.
- Compose menus from shared Dropdown content, groups, items, labels, and indicators without row spacing overrides; keep phone choices on MobileDrawer parts.
- Keep All models as a desktop submenu and a pushed phone page; derive both catalogs from non-Suggested IDs, including search, and omit empty provider groups.
- Use the shared grouped Tabs pill for Auto/Chat/Code on desktop and in the phone drawer; keep its Auto gate and host mode state unchanged.
- Keep session model controls inside the composer; place only + on the left and dictation, model, then Send/Stop on the right, with desktop mode/repository controls in the right group and phone controls in their upper drawer.
- Follow Root-and-parts composition and the [frontend feature architecture](../../../../../docs/architecture/frontend-features.md).
- Keep catalog option identities stable across capability updates; isolate optional speed-marker discovery with Suspense so it cannot detach the editor.
- Keep phone file inputs and overlay owners mounted on blur; add-menu, model, and repository sheets hold the composer expanded.
- Keep the phone list composer's unfocused 46px pill vertically centered with no Send control; hide controls without unmounting their file or overlay owners.

## Checks

From `apps/web`:

- `bun run test --project app src/features/agents-view`
- `bun run test --project app src/lib/i18n`
- `bun run type-check`
- `bunx playwright test --config src/features/agents-view/browser-test/playwright.config.ts`: timestamp overlay geometry, hover/focus, and active-surface regression.

From the repository root, run `just check`. Exercise the sidebar, archive actions, PR/branch previews, phone flows, and unchanged Home consumers before release.

## Related

- [AI chat walkthrough](../../../../../docs/agent-guide/ai-chat.md)
- [Web guide](../../../AGENTS.md)

Keep session names and agent-bubble labels at the normal list-row weight on desktop and phone, including archive, preview, and header surfaces; unread uses a dot, never heavier text.
