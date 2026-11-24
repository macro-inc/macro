# Agents workspace

Status: redesigned desktop/phone lists, shared model selection, phone composer, and phone session header.

## What it is

The Agents workspace owns conversation navigation, the agent roster, and new-chat composition. Transcript and runtime behavior belong to `features/block-agent`.

## Start here

- `views/AgentsView.tsx`: production query, selection, draft, and navigation ownership.
- `phone-list.tsx` and `components/phone-list-section.tsx`: phone list, in-flow section headings, archive, favorites, bubbles, and existing entity actions.
- `phone-sidebar.tsx` and `views/mobile/agents-navigation.tsx`: shell-owned phone drawer and shared routine list data.
- `core/phone-list.ts`: waiting/favorite partition and startable agent selection.
- `primitives/mobile-agent-request.ts`: selection handoff to the mounted accessory composer.
- `views/agents-sidebar/agents-sidebar.tsx`: redesigned desktop list composition.
- `views/archived-conversations/archived-conversations.tsx`: archived conversations in the main pane.
- `archive-navigation.ts`: durable `/agents/archive` route identity and migration from legacy in-place Archived state.
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
- Show phone conversation and archive totals only after the shared query is exhausted; never present a loaded-page count as a total.
- Keep the `connections` page routable even though the redesigned navigation omits it.
- Preserve `agents-conversation-list-view-v1` filters when changing sort; legacy grouping does not determine the redesigned list.
- Persist phone Archived filters separately from Conversations so an active unread filter cannot hide archived history on entry.
- Navigate Archived through `/agents/archive` under the app base; retain shared workspace state across Back/Forward, migrate legacy in-place entries without pushing duplicates, and render the archive directly inside ViewShell.Main with its heading in the list's content padding, outside the legacy composer/Topbar wrappers.
- Partition desktop rows once: Waiting on you first, flagged Open PRs second, Conversations last; share filters and sort, and fill paging from unpinned Conversations.
- Keep archive code/date cells pointer-transparent except their actual controls; show an empty archive only after pagination is exhausted, with loading feedback while pages can still supply matches.
- Render desktop row ages in the interface locale on a state-matched trailing fill with a 24px left fade; retain hover/focus visibility and title truncation.
- Show conversation-name tooltips only when their rendered label is truncated; measure `scrollWidth > clientWidth` for each open request rather than caching a mount-time width.
- Give rows the shared touch press (`data-press-surface`, `components/app/mobile/rowPress.ts`) and keep phone rows full-width, nonshrinking, and square; a long press that opens the row's action drawer clears the press (`touchHandler`). Keep button press fills off the title-only hit target.
- Use shared Popover and Dropdown surfaces without local fill, border, shadow, radius, or item sizing; use Menu rows/groups on desktop and MobileDrawer rows/sections on phone.
- Open the unified selector as a card first: Thinking and Speed stay on the card, model picking uses in-place desktop pages or the phone sheet, and All models includes the complete provider catalog. Keep search keyboard handoff, five user-scoped recent model IDs, recent agent rows, and grouped See all agents; put custom-agent overrides behind the card's Model row and return its provider-grouped `agentModels` page directly to the card.
- Let Menu.Group own card padding and shared Popover own its surface; keep width and scrolling only as placement constraints, use standard phone drawer geometry, gate agent Thinking and Speed on capabilities, and retain fixed Model rows for single-model runtimes.
- Open the desktop card and selection pages below the trigger, end-aligned with a 6px gap; flip above only when needed, without changing the phone sheet.
- Await asynchronous host confirmation before dismissing selection pages or recording recents, reject false results, and discard late account changes; keep selector action telemetry open through confirmation.
- Show a Thinking label in the trigger only when the effective choice differs from the model's advertised default; never treat a confirmed session value as that default. Use the standard link Button for See all agents with a trailing right-arrow icon.
- Keep custom-agent model pins browser-local per account and agent; preserve pinned overrides across sends, clear pins on the agent default or confirmed catalog retirement, and never mutate the agent's shared default.
- Keep Suggested below Recent, using only fixed frontier matches, excluding Auto and Recent, with at most five models and no full-catalog fallback.
- Use semantic hover, active, selected, overlay and shadow tokens throughout the selector; keep Speed triggers neutral at every tier, retain accelerated glyphs, and retain the shared Slider disabled treatment.
- Build card name, agent-model, Thinking value, and Speed triggers from Button with variant="ghost" and size="xs"; leave padding, radius, typography, hover, active, focus, and disabled styles to Button, and use Slider tone="neutral" with its standard thumb for Thinking.
- Keep model-selector cards and sheets in the composer's active interaction lifetime; dismiss them when navigation removes or hides their trigger, and unmount the card while a phone sheet owns focus.
- Scope model discovery by account, preserve kept models while discovery is pending, and retire them only against a successful catalog for that account.
- Reuse AgentAvatar for selector agent identities at the specified sizes; keep the agents-view circular surface-1 fill and muted glyph rather than the person-avatar treatment.
- Give every More models row its provider logo and keep provider headings text-only; render matching Auto in its own heading-free section on the main, More models, and agent-model pages, including search results.
- Group each selector heading with its rows through the shared menu or drawer group; retain heading-free Auto groups and use parent gaps rather than child layout margins.
- Keep focus on the stable popover before replacing a desktop page, run open-autofocus imperatively under untrack so page changes cannot restart the library focus scope, and wait for the phone sheet's final focus callback before remounting the card.
- Use shared InputGroup search and its ClearButton on every selector page; keep the query-aware empty state and Clear search action, and opt the search group out of drawer dragging.
- Use shared grouped Tabs for the compact phone accessory and Home's track tabs for full new-session views; keep the Auto gate and host mode state unchanged.
- Keep session model controls inside the composer, with only + on the left and model, dictation, then Send/Stop on the right; full new-session views share Home's mode/repository row below the composer on desktop and phone, while the compact phone accessory retains its upper drawer.
- Use `MobileHeader.Title` with its shared padding and `MobileHeader.Back` with the shell's history action and caret; do not hand-build title or back islands.
- Push phone subpages into split history and derive their restored state without navigating again; let nested agent editors consume Back before leaving their list.
- Suppress the mobile navigation dock only in active session hosts with an empty `FloatRegion` contribution; retain header/gesture Back and the shared accessory host's safe-area padding, and restore navigation on list and management pages.
- Use Email's collection-layout NavigationSheet and ViewSidebar sections for phone destinations; Conversations and Archived keep the hamburger, never a title-menu sheet or Archived Back button.
- Mark drawer destinations with the existing `referredFrom: 'agents'` origin and read current router-entry metadata for management-page navigation; drawer entries show the hamburger, external entries and details keep Back.
- Keep phone list headings in normal flow inside their row sections, with no sticky positioning or per-heading offsets; use one vertical scroller, apply MobileListLayout's measured island inset once as its top padding, and use parent gaps/padding instead of child layout margins.
- Reuse EmptyStatePanel for exhausted empty phone lists with embedded scrolling disabled; omit search/filter actions and focus the existing accessory composer from Start a conversation.
- Follow Root-and-parts composition and the [frontend feature architecture](../../../../../docs/architecture/frontend-features.md).
- An agent picked from the new-conversation composer's @ menu (Agents page, Home and the phone composer, which all mount `NewChatPage`) becomes the selected agent through `rosterAgentForMention` and the picker's own `selectAgent`; never add a second selection path.
- Keep catalog option identities stable across capability updates; isolate optional speed-marker discovery with Suspense so it cannot detach the editor.
- Keep phone file inputs and overlay owners mounted on blur; let open add-menu, model, and repository controls own keyboard dismissal and count as composer focus, track physical focus separately, and release expansion only after each control's final focus restoration when focus remains outside; aggregate overlapping repository, branch, add-menu, and settings scopes.
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
