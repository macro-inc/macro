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

- Scope `agents-view.css` rules with `:where(.agents-scope)`, and give every container that renders them (`.agents-view`, `.agents-view-portal`) the `agents-scope` class: a multi-class `:where()` or a `… *` rule makes every element in the app walk to the root on each restyle (see the web guide's whole-page restyle section).
- Use the unified selector for Home, new chats, inline and standalone sessions, universal-input AI drafts, and routine agent/model targets; keep old picker components unwired for reference and preserve each host's preference and mutation ownership.
- Keep `components/AgentsSidebar.tsx`, `AgentSessionRow.tsx`, and `views/AgentSessionListItem.tsx` for reference and Home consumers.
- Preserve Home row geometry and activity rendering when extracting shared behavior.
- Reuse Soup entity actions and session archive mutations; do not add another action or cache path.
- Fetch PR metadata only for an open preview, never eagerly for every conversation row.
- Keep unsupported remote metadata absent; archived counts describe loaded pages.
- Keep the `connections` page routable even though the redesigned navigation omits it.
- Preserve `agents-conversation-list-view-v1` filters when changing sort; legacy grouping does not determine the redesigned list.
- Partition desktop rows once: Waiting on you first, flagged Open PRs second, Conversations last; share filters and sort, and fill paging from unpinned Conversations.
- Keep archive code/date cells pointer-transparent except their actual controls; show an empty archive only after pagination is exhausted, with loading feedback while pages can still supply matches.
- Render desktop row ages in the interface locale as pointer-transparent hover/focus overlays using the row's hover or active surface; never let the age change title truncation or appear on phone rows.
- Use the shared soup touch highlight and full-width square phone rows; clear it on drawer open/close and cancellation, and keep button press fills off the title-only hit target.
- Compose menus from shared Dropdown content, groups, items, labels, and indicators without row spacing overrides; separate model-menu groups with labels and spacing, never divider lines, and keep phone choices on MobileDrawer parts.
- Open the unified selector as a card first: Thinking and Speed stay on the card, model picking uses in-place desktop pages or the phone sheet, and All models includes the complete provider catalog. Keep search keyboard handoff, five user-scoped recent model IDs, recent agent bubbles, and grouped See all agents; retain custom-agent model overrides in the selection list.
- Keep the card's specified 360px desktop/358px phone geometry, `bg-ink/8` field and `bg-ink/12` selection tokens, and exact control sizes local to the selector; these approved design dimensions deliberately differ from generic controls. Agent and Auto cards have no settings; models without adjustable effort keep the no-thinking slot.
- Await asynchronous host confirmation before recording a recent selection, reject false results, and discard late account changes; keep selector action telemetry open through confirmation.
- Use shared grouped Tabs for Agents modes and preserve Home's original track tabs and below-composer settings drawer; keep the Auto gate and host mode state unchanged.
- Keep session model controls inside the composer; place only + on the left and model, dictation, then Send/Stop on the right, with Agents desktop mode/repository controls in the right group, Home settings below, and phone controls in their upper drawer.
- Use `MobileHeader.Title` with its shared padding and `MobileHeader.Back` with the shell's history action and caret; do not hand-build title or back islands.
- Push phone subpages into split history and derive their restored state without navigating again; let nested agent editors consume Back before leaving their list.
- Suppress the mobile navigation dock only in active session hosts with an empty `FloatRegion` contribution; retain header/gesture Back and the shared accessory host's safe-area padding, and restore navigation on list and management pages.
- Follow Root-and-parts composition and the [frontend feature architecture](../../../../../docs/architecture/frontend-features.md).
- An agent picked from the new-conversation composer's @ menu (Agents page, Home and the phone composer, which all mount `NewChatPage`) becomes the selected agent through `rosterAgentForMention` and the picker's own `selectAgent`; never add a second selection path.
- Keep catalog option identities stable across capability updates; isolate optional speed-marker discovery with Suspense so it cannot detach the editor.
- Keep phone file inputs and overlay owners mounted on blur; add-menu, model, and repository sheets hold the composer expanded.
- Keep the phone list composer's unfocused 46px pill vertically centered with no Send control; hide controls without unmounting their file or overlay owners.
- Keep phone composer layout measurable while collapsed; animate the clipped shape and editor insets together, reveal inert controls during the final part of the 200ms expansion, and disable transitions for reduced motion.

## Checks

From `apps/web`:

- `bun run test --project app src/features/agents-view`
- New-conversation composer in a browser, backend-free (real `NewChatPage` and @ menu, mocked catalogs): `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome bunx playwright test --config src/features/agents-view/browser-test/playwright.config.ts`. Mention chips render empty there; the started-prompt log shows the mention markup.
- `bun run test --project app src/lib/i18n`
- `bun run type-check`

From the repository root, run `just check`. Exercise the sidebar, archive actions, PR/branch previews, phone flows, and unchanged Home consumers before release.

## Related

- [AI chat walkthrough](../../../../../docs/agent-guide/ai-chat.md)
- [Web guide](../../../AGENTS.md)

Keep session names and agent-bubble labels at the normal list-row weight on desktop and phone, including archive, preview, and header surfaces; unread uses a dot, never heavier text.
