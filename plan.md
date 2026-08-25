# Implementation Plan

## Goal
Introduce a persisted, registry-based app-layout system that can support any number of layouts, preserve Classic and the current experiment as v1, add an isolated v2 with the requested sidebar information architecture, and give v2 app views a direct split-chrome composition path without changing Classic, v1, or touch/mobile behavior.

## Review Findings

- **High — layout selection is currently a boolean spread across shared surfaces.**
  - Files: `apps/web/src/features/experimental-app-layout/state.ts`, `apps/web/src/components/app/Layout.tsx`, `apps/web/src/components/app/GlobalHotkeys.tsx`, `apps/web/src/components/app/split-layout/SplitLayout.tsx`, `apps/web/src/components/app/split-layout/SplitLayoutRoute.tsx`, `apps/web/src/components/app/split-layout/components/SplitHeader.tsx`, `apps/web/src/components/app/split-layout/components/SplitPanel.tsx`, `apps/web/src/features/next-soup/soup-view/soup-view.tsx`, `apps/web/src/features/activity/my-activity-view.tsx`, and `apps/web/src/features/next-soup/soup-view/use-is-new-inbox-enabled.ts`.
  - `experimentalAppLayoutEnabled()` currently answers both “which layout?” and “does this layout have experimental capabilities?” Adding more booleans would create combinatorial conditionals and would not support N layouts cleanly.

- **High — the current split chrome is not merely a global visual component; it is a runtime slot system.**
  - Files: `apps/web/src/components/app/split-layout/components/SplitHeader.tsx`, `apps/web/src/components/app/split-layout/components/SplitToolbar.tsx`, `apps/web/src/components/app/split-layout/components/SplitLabel.tsx`, and `apps/web/src/components/app/split-layout/context.ts`.
  - `SplitHeader` owns universal navigation, close/sidebar controls, drag/drop, context-menu behavior, responsive priority collapsing, and the left/right portal targets. `SplitToolbar` adds two more portal targets, and `SplitTitleFileMenu` portals file actions into a title created elsewhere.
  - Repository search found roughly 30 production/debug `SplitHeaderLeft` call sites, roughly 18 `SplitHeaderRight` call sites, and multiple toolbar slot consumers. A direct global replacement is substantially larger than an app-layout fork.

- **High — full block-header de-portaling cannot be achieved by only extending `componentRegistry.tsx`.**
  - Files: `apps/web/src/components/app/split-layout/componentRegistry.tsx`, `apps/web/src/components/app/split-layout/layoutManager.ts`, `apps/web/src/lib/core/block.ts`, `apps/web/src/features/block-md/component/TopBar.tsx`, `apps/web/src/features/block-channel/component/Top.tsx`, `apps/web/src/features/block-email/component/TopBar.tsx`, and `apps/web/src/components/app/ResponsiveBlockToolbar.tsx`.
  - Component mounts currently expose only `element` and optional metadata; block mounts expose only the orchestrated block element and handle. Many block header contributions read block-scoped providers for document names, permissions, collaboration state, channel state, and tools. A header factory rendered as a sibling by `SplitPanel` would be outside those providers and cannot safely consume that state.

- **Medium — v1 experimental app views already provide a useful non-portal seam.**
  - Files: `apps/web/src/features/experimental-app-layout/experimental-soup-layout.tsx`, `apps/web/src/features/experimental-app-layout/experimental-activity-view.tsx`, and `apps/web/src/features/experimental-app-layout/experimental-chat-view.tsx`.
  - These views already render much of their visible title/navigation chrome inside their own content tree. V2 can turn that pattern into an explicit composed split-view shell and opt out of the legacy `Panel.Header`, while blocks and unmigrated component views retain the legacy portal path.

- **Medium — Messages is a special migration case.**
  - Files: `apps/web/src/features/experimental-app-layout/experimental-messages-rail.tsx`, `apps/web/src/features/experimental-app-layout/experimental-soup-layout.tsx`, and `apps/web/src/features/block-channel/component/NewChannelBlockAdapter.tsx`.
  - The Messages workspace embeds a channel block, and that block still emits `SplitHeaderLeft`/`SplitHeaderRight` contributions. Hiding the legacy header for Messages without adding an embedded/direct-header adapter would silently drop channel title and action controls.

- **Medium — mobile/touch gating should be centralized.**
  - Files: all current `experimentalAppLayoutEnabled()` consumers listed above.
  - The requirement is that touch/mobile remain Classic even if a desktop experiment is persisted. A single `effectiveAppLayout()` resolver should enforce this rather than relying on every consumer to remember `!isTouchDevice()`.

## Tasks

1. **Introduce the layout ID, registry contract, persistence, validation, and legacy migration.**
   - Files:
     - `apps/web/src/features/app-layout/layout-registry.tsx`
     - `apps/web/src/features/app-layout/layout-state.ts`
     - `apps/web/src/features/experimental-app-layout/state.ts`
   - Changes:
     - Define stable IDs such as `classic`, `experimental-v1`, and `experimental-v2` from registry keys rather than independent booleans.
     - Define an `AppLayoutDefinition` containing label, capabilities, optional surface overrides, and split-chrome policy. Capabilities should cover behavior shared by multiple experiments (for example `usesExperimentalSoup`, `usesNewInbox`, `removesSplitContentLeftPadding`, and `splitChrome: 'legacy' | 'composed-app-views'`) so shared code never checks for a specific experiment ID unless truly variant-specific.
     - Persist one layout ID under a new key such as `macro:pref:app-layout-id`.
     - Validate stored values against the registry and fall back to `classic` for unknown/removed IDs.
     - Migrate the legacy `macro:pref:experimental-app-layout` value: `true` becomes `experimental-v1`; `false` or absent becomes `classic`. Do not migrate an already-valid new key.
     - Export both the persisted preference and an `effectiveAppLayout()` accessor that always resolves to Classic on touch/mobile.
     - Keep `apps/web/src/features/experimental-app-layout/state.ts` as a temporary compatibility adapter only while callers are migrated, then remove its boolean toggle API.
   - Acceptance:
     - Adding a future experiment requires registering a new definition rather than adding another global boolean.
     - Invalid persisted values render Classic.
     - Existing experiment users remain on v1 after migration.
     - Touch/mobile render Classic regardless of the persisted desktop choice.

2. **Generate layout-switch commands from the registry.**
   - File: `apps/web/src/components/app/GlobalHotkeys.tsx`
   - Changes:
     - Remove the binary toggle command.
     - Register one searchable command per registry definition (for example “Use Classic app layout”, “Use Experimental v1 app layout”, and “Use Experimental v2 app layout”).
     - Hide or disable the command for the currently effective layout and show a success toast after selection.
     - Keep layout switching hot-reload/reactive and preserve the existing keywords for layout/sidebar discovery.
   - Acceptance:
     - All registered layouts are selectable without adding new command-menu branching.
     - Selection persists across reloads.
     - Switching among Classic, v1, and v2 does not require a page reload.

3. **Snapshot the current experiment as immutable v1 and create the v2 fork.**
   - Files:
     - Existing `apps/web/src/features/experimental-app-layout/*.tsx` remain the v1 implementation.
     - New `apps/web/src/features/experimental-app-layout-v2/*.tsx` mirror the current v1 files that participate in layout/styling: app sidebar, Soup layout, Activity, Chat, list row/group/automation rendering, Powers details, Integrations, Memories, Messages rail, Favorites, and in-view sidebar.
     - `apps/web/src/features/app-layout/layout-registry.tsx`
   - Changes:
     - Register Classic with no experimental surface overrides.
     - Register v1 against the existing components.
     - Register v2 against copied components in the new directory.
     - Avoid importing v2 internals from v1 or vice versa; utilities that are genuinely behavior-only may be moved into a neutral shared directory after the snapshot, but visual components should remain isolated.
   - Acceptance:
     - A later edit to a v2 sidebar, row, header, Messages rail, or Powers view does not change v1.
     - Switching back to v1 reproduces the current implementation.

4. **Route all layout-sensitive rendering through registry surfaces and capabilities.**
   - Files:
     - `apps/web/src/components/app/Layout.tsx`
     - `apps/web/src/features/next-soup/soup-view/soup-view.tsx`
     - `apps/web/src/features/activity/my-activity-view.tsx`
     - `apps/web/src/components/app/split-layout/componentRegistry.tsx`
     - `apps/web/src/components/app/split-layout/SplitLayout.tsx`
     - `apps/web/src/components/app/split-layout/SplitLayoutRoute.tsx`
     - `apps/web/src/components/app/split-layout/components/SplitHeader.tsx`
     - `apps/web/src/components/app/split-layout/components/SplitPanel.tsx`
     - `apps/web/src/features/next-soup/soup-view/use-is-new-inbox-enabled.ts`
   - Changes:
     - Resolve sidebar, Soup layout, Soup row/group/card components, Activity view, and standalone Chat workspace from the active layout definition.
     - Replace shared boolean checks with named capabilities from the effective layout.
     - Keep the existing `/channels` workspace route behavior enabled for v1 and v2 through a capability rather than an experiment ID comparison.
     - Preserve Classic fallback components exactly as they are now.
   - Acceptance:
     - Classic uses the production sidebar/Soup/Activity/Chat and legacy split chrome.
     - V1 uses only v1 surfaces.
     - V2 uses only v2 surfaces.
     - Shared experimental behavior is enabled by capabilities, not hardcoded mode-name conditionals.

5. **Implement the requested v2 sidebar information architecture.**
   - File: `apps/web/src/features/experimental-app-layout-v2/experimental-app-sidebar.tsx`
   - Changes:
     - Render items in this order:
       1. Create — `SidebarCreateMenu`, not a navigable split.
       2. Search — component `search` with the magnifying-glass icon.
       3. Activity — component `activity` with the bell icon.
       4. Brain — component `agents`, using the brain icon and the existing Automations/Skills/Integrations/Memories content.
       5. Calendar — singleton `calendar` block using `CALENDAR_BLOCK_ID` and the calendar icon.
       6. Email — component `mail` with the envelope icon.
       7. Chat — the `/channels` Messages workspace with a chats/messages icon and the experiment’s conversations preset.
       8. Drive — component `documents` with a drive/files icon; retain the current Library-backed document/file/filter implementation until a separate Drive taxonomy is specified.
       9. Tasks — component `tasks` with the check-square icon.
       10. CRM — component `companies` with a buildings/CRM icon; honor `ENABLE_CRM` unless product explicitly wants a disabled item visible.
     - Preserve normal click vs Shift-click split behavior where applicable; Create opens its menu, Chat uses `/channels`, and Calendar retains singleton semantics.
     - Update active-state matching for both component-backed and block-backed items.
     - Keep settings, command access, and sidebar expand/slim controls unless product explicitly removes them in a later styling pass.
   - Acceptance:
     - V2 shows exactly the requested ordering and icons/labels.
     - V1 keeps its current Home/Inbox/Activity/Library/Powers/Email/Tasks/Messages order.
     - Classic is unchanged.

6. **Add a v2-only, content-owned split-view composition API for app views.**
   - New files:
     - `apps/web/src/components/app/split-layout/composed/ComposedSplitView.tsx`
     - `apps/web/src/components/app/split-layout/composed/ComposedSplitHeaderControls.tsx`
     - `apps/web/src/components/app/split-layout/composed/types.ts`
   - Modified files:
     - `apps/web/src/components/app/split-layout/components/SplitHeader.tsx`
     - `apps/web/src/components/app/split-layout/components/SplitPanel.tsx`
     - `apps/web/src/features/app-layout/layout-registry.tsx`
   - Changes:
     - Extract reusable non-slot primitives from the existing global header: sidebar expand, close, back/forward, Soup previous/next where applicable, header context menu, and drag/drop target behavior. Keep the legacy `SplitHeader` assembling those primitives exactly as before for Classic/v1.
     - Add `ComposedSplitView.Root`, `.Header`, `.Toolbar`, and `.Body` primitives. A v2 view should render its header controls and view-specific controls as direct children in one owner tree; these primitives must not use `Portal`.
     - Add a layout-registry policy that resolves whether a given component content ID owns its split chrome. Do not infer this from generic `component` vs block type because Search, Settings, and other component views still depend on legacy slots.
     - In `SplitPanel`, hide the legacy `Panel.Header`/`Panel.Toolbar` only when the effective v2 definition declares the current component view content-owned. Continue mounting legacy chrome for every Classic/v1 view and every unmigrated v2 view/block.
     - Preserve panel rounding, focus styling, Preview Pair behavior, header height variables, bottom panels, split hotkeys, and touch behavior.
   - Acceptance:
     - Classic/v1 still mount the existing `SplitHeader` and portal targets.
     - Migrated v2 app views render one directly composed header without `SplitHeaderLeft`, `SplitHeaderRight`, `SplitToolbarLeft`, or `SplitToolbarRight`.
     - Unmigrated block/entity views continue using the legacy global header without losing controls.

7. **Port v2 Soup-backed app views to direct header composition.**
   - Files:
     - `apps/web/src/features/experimental-app-layout-v2/experimental-soup-layout.tsx`
     - `apps/web/src/features/next-soup/soup-view/soup-view.tsx`
     - `apps/web/src/features/app-layout/layout-registry.tsx`
   - Changes:
     - Compose each v2 view header explicitly through `ComposedSplitView`: Brain, Email, Drive, Tasks, CRM, and any v2 Inbox/List view retained internally.
     - Move view-specific title, tabs, search, filters, create actions, navigation collapse controls, and preview controls into that view’s direct header/toolbar composition.
     - Declare only successfully migrated content IDs as content-owned in the v2 registry.
     - Keep Soup state providers above both header and body so direct header controls can consume the same Soup context without portals.
   - Acceptance:
     - Each migrated v2 view owns the order and presence of its split-header parts.
     - Header controls remain reactive to Soup state, responsive width, and split history.
     - V1’s existing `ExperimentalSoupLayout` is unchanged.

8. **Port v2 Activity and other simple component views to direct composition.**
   - Files:
     - `apps/web/src/features/experimental-app-layout-v2/experimental-activity-view.tsx`
     - `apps/web/src/features/experimental-app-layout-v2/experimental-chat-view.tsx`
     - `apps/web/src/features/app-layout/layout-registry.tsx`
   - Changes:
     - Replace v2 Activity’s legacy header contribution with an explicit `ComposedSplitView.Header`.
     - Evaluate standalone AI Chat separately from channel Messages; only mark it content-owned after its history/sidebar and block metadata controls are composed without depending on legacy header targets.
     - Keep Search, Calendar, Settings, compose screens, and other unported component views on legacy chrome.
   - Acceptance:
     - Directly migrated v2 components do not portal into the split header.
     - Any view not yet migrated remains fully functional under legacy split chrome.

9. **Handle v2 Messages as an explicit hybrid migration.**
   - Files:
     - `apps/web/src/features/experimental-app-layout-v2/experimental-soup-layout.tsx`
     - `apps/web/src/features/experimental-app-layout-v2/experimental-messages-rail.tsx`
     - `apps/web/src/features/block-channel/component/NewChannelBlockAdapter.tsx` only if an opt-in embedded composition API is approved.
   - Changes:
     - Initially keep Messages on legacy split chrome even though its rail/body are v2, preventing the embedded channel block’s title/actions from disappearing.
     - In a follow-up, add an explicit embedded-channel presentation contract that returns direct header/body regions or suppresses legacy contributions while v2 supplies equivalent channel title/call/action controls.
     - Only then mark `channels` as content-owned for v2.
   - Acceptance:
     - `/channels` and `/channels/:id` retain selection, split suffixes, DM/channel behavior, and all channel actions throughout migration.
     - No header action is lost merely because v2 is active.

10. **Treat full block-header de-portaling as a separately approved refactor, not part of the first v2 fork.**
    - Likely files:
      - `apps/web/src/lib/core/block.ts`
      - `apps/web/src/lib/core/orchestrator.tsx`
      - `apps/web/src/components/app/split-layout/layoutManager.ts`
      - All production block `TopBar.tsx`, `Header.tsx`, and responsive toolbar call sites found by the review.
    - Changes if approved later:
      - Extend block definitions/mounts with a layout-aware composed-view factory created inside the same Solid owner/provider tree as the block body.
      - Migrate one representative block (Channel or Markdown) end-to-end before changing the block contract globally.
      - Provide dual rendering paths: direct regions for v2 and legacy portal contributions for Classic/v1 until every block is migrated.
      - Migrate title file menus, permissions, collaboration indicators, side-panel controls, and toolbar tools along with left/right header slots.
    - Acceptance:
      - This phase starts only after the app-view composition proof is reviewed.
      - No block is marked direct-composed until feature parity is manually verified.

11. **Perform manual validation without adding or running tests.**
    - Files: none.
    - Changes: none.
    - Acceptance:
      - Verify persistence and migration for Classic, v1, and v2.
      - Verify mobile/touch always remain Classic.
      - Compare v1 before/after to ensure no visual or navigation drift.
      - Verify every v2 sidebar item, active state, normal click, Shift-click, and narrow/slim state.
      - Verify migrated v2 headers in one split, multiple splits, Preview Pairs, spotlight, close/back/forward, sidebar collapse, drag/drop, and narrow widths.
      - Verify legacy-header views and blocks under v2 still show all title/actions/toolbars.
      - Run `git diff --check` only, consistent with the current no-tests request.

## Files to Modify

- `apps/web/src/components/app/GlobalHotkeys.tsx` - generate layout commands from the registry.
- `apps/web/src/components/app/Layout.tsx` - resolve the active sidebar surface.
- `apps/web/src/components/app/split-layout/SplitLayout.tsx` - use layout capabilities for spacing and retain shared split behavior.
- `apps/web/src/components/app/split-layout/SplitLayoutRoute.tsx` - use capabilities for the Messages workspace route.
- `apps/web/src/components/app/split-layout/componentRegistry.tsx` - resolve layout-specific component surfaces and/or content-owned chrome metadata.
- `apps/web/src/components/app/split-layout/components/SplitHeader.tsx` - extract reusable universal controls while preserving the legacy assembly.
- `apps/web/src/components/app/split-layout/components/SplitPanel.tsx` - choose legacy vs content-owned chrome per effective layout and view.
- `apps/web/src/features/activity/my-activity-view.tsx` - resolve v1/v2 Activity surfaces.
- `apps/web/src/features/experimental-app-layout/state.ts` - migrate/re-export compatibility state during rollout.
- `apps/web/src/features/next-soup/soup-view/soup-view.tsx` - resolve v1/v2 Soup layout and row/header surfaces.
- `apps/web/src/features/next-soup/soup-view/use-is-new-inbox-enabled.ts` - use a capability rather than the old boolean.

## New Files

- `apps/web/src/features/app-layout/layout-registry.tsx` - N-layout definitions, labels, capabilities, surface overrides, and v2 content-owned chrome policy.
- `apps/web/src/features/app-layout/layout-state.ts` - persisted validated layout ID, legacy migration, setter, and effective touch-safe resolver.
- `apps/web/src/features/experimental-app-layout-v2/*.tsx` - isolated v2 fork of the current visual experiment.
- `apps/web/src/components/app/split-layout/composed/ComposedSplitView.tsx` - direct Root/Header/Toolbar/Body composition primitives.
- `apps/web/src/components/app/split-layout/composed/ComposedSplitHeaderControls.tsx` - reusable universal split controls without slot portals.
- `apps/web/src/components/app/split-layout/composed/types.ts` - direct split-chrome contracts.

## Dependencies

- Task 2 depends on Task 1.
- Task 3 depends on the registry contract from Task 1.
- Task 4 depends on Tasks 1 and 3.
- Task 5 depends on Tasks 3 and 4.
- Task 6 depends on Task 4 and should be reviewed before porting views.
- Tasks 7–9 depend on Task 6.
- Task 10 is explicitly deferred until Tasks 6–9 prove the composition API and product confirms full block migration scope.
- Task 11 depends on all implemented phases.

## Risks

- The phrase “per view” is ambiguous. The recommended first scope is **v2 app/component views only**, with a hybrid fallback to legacy chrome for blocks and unmigrated views. A full no-portal block migration is feasible only as a major cross-feature refactor and cannot preserve Classic/v1 risk-free in the same first slice.
- Duplicating the complete v1 visual directory gives strong isolation but increases maintenance and bundle/module graph size. The registry should allow optional shared surfaces so future experiments fork only the parts they intentionally change.
- Creating view header factories outside the view/body provider tree will break Soup and block context access. Direct composition must happen inside the content owner tree, not as sibling factories mounted by `SplitPanel`.
- Hiding the legacy header also removes drag/drop, context menu, navigation, close, sidebar-expand, responsive collapsing, and measured header height unless each behavior is deliberately composed into the new shell.
- Messages embeds a channel block and must remain hybrid until channel header actions have an explicit embedded contract.
- CRM visibility depends on `ENABLE_CRM`; product should confirm whether v2 hides CRM when unavailable or displays a disabled entry.
- “Drive (files and all other items)” is currently only safely mapped to `documents`. Any broader entity taxonomy or a replacement for Inbox/Home requires a separate product specification.
- Unknown/retired persisted experiment IDs must never crash layout resolution.

## Residual Risks

- Even with app-view-only direct composition, shared split primitives are touched; incorrect extraction could regress legacy chrome unless the old `SplitHeader` remains the source-of-truth assembly during migration.
- Multiple experimental layouts can share routing capabilities but may eventually need incompatible URL contracts; those should be explicit registry capabilities/codecs rather than mode-name branches.
- Full block de-portaling will require coordinated migrations across Markdown, PDF, Channel, Email, Calendar, Canvas, Project, Call, media, Settings, SidePanel, and responsive toolbar infrastructure.
- No automated tests are requested, so persistence migration, registry fallback, and split-chrome parity rely on careful manual verification.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The plan includes severity-ranked review findings with exact file paths, an ordered staged implementation, exact files to modify/create, and a Residual Risks section."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "Repository grep/read inspection of app-layout state, GlobalHotkeys, Layout, SoupView, SplitHeader, SplitToolbar, SplitLabel, SplitPanel, componentRegistry, layoutManager, block definitions, and all SplitHeaderLeft/Right/toolbar consumers",
      "result": "passed",
      "summary": "Confirmed the boolean layout coupling, portal-slot scope, block-context constraints, and the viable v2 app-view composition seam."
    }
  ],
  "validationOutput": [
    "No code files were modified and no tests were written or run; only plan.md was created as requested."
  ],
  "residualRisks": [
    "Full block-header de-portaling is a major cross-feature refactor and should not be bundled into the first v2 app-layout fork.",
    "Messages must remain hybrid until embedded channel header controls have a direct-composition contract.",
    "CRM feature-flag visibility and the exact Drive taxonomy need product confirmation."
  ],
  "noStagedFiles": true,
  "notes": "Recommended decision: approve v2 app/component-view composition first while preserving legacy portal chrome for Classic, v1, blocks, and unmigrated views; approve full block migration separately."
}
```
