# Workspace sidebar spacing

The `--sidebar-*` tokens in `src/index.css` own sidebar geometry. Compose the
slots below instead of adding per-workspace padding or button size overrides.

| Measurement | Desktop default |
| --- | --- |
| Outer gutter / row inset | 8px / 8px |
| Icon slot / glyph | 20px / 16px |
| Control target | 24px (36px on touch) |
| Row height / gap | 32px / 2px (44px row on touch) |
| Icon-to-label gap | 6px |
| Section gap / header-to-content gap | 24px / 4px |
| Title bar height | 48px |

Both rails sit `gutter + row inset + icon slot / 2 = 26px` from the sidebar edge.
The control inset is derived from that center and the control's size. Never
align trailing controls by their outer edges or offset an individual icon.

- `ViewSidebar.Primary` gives create actions and toolbars the same 8px top inset.
- `ListHeader` reserves the title's natural width and scrolls right-aligned controls
  in the remaining space; keep switcher triggers inside the title's clip boundary.
- Keep collection navigation on the left and search/filter actions on the right; on touch, keep trailing actions outside scrollable view tabs. Give the action group `min-w-0 flex-1` and use the search field's `wide` layout so expanded search fits the remaining width, including 320px panes.
- Render the shared expandable Search trigger with the same 40px glass island and 24px glyph as the other floating touch controls; keep desktop Search at its existing control size.
- `ViewSidebar.CloseButton` closes the owning split in both docked navigation and
  narrow navigation overlays. Its visibility follows the split controller, not
  the sidebar breakpoint; the last remaining list split still has no close action.
- `ViewSidebar.Toolbar` aligns its final `Control` with the right rail.
- `ViewSidebar.Content` owns outer gutters, 16px top/bottom padding, and section gaps.
- `Item` and `Action` own row spacing; use `Icon` for leading glyphs and
  `Trailing` for non-interactive trailing glyphs such as a create-menu chevron.
- `CollapsibleSection.Header` and `Action` align section controls on the same rail.
- `TreeItem` and `Branch` own disclosure positioning and the nested rail.
- Use `--sidebar-action-inset` for a trailing control beside a separate selectable
  row, as in Email's inbox list. Do not repeat numeric offsets in the workspace.

## Section order

Give `ViewSidebar.Root` a stable `reorderId` for its view. Give each top-level
`CollapsibleSection.Root` a stable `sectionId` and a `sectionLabel`, and compose
its trigger and actions inside `CollapsibleSection.Header`. Non-collapsible
sections use `ViewSidebar.Section` (`id`, `label`) and `ViewSidebar.SectionHeader`.
For an unnamed navigation group, use `headerless`: `label` supplies only its
accessible region name. It has no drag handle, drag source, or keyboard move
control, but remains a drop target in the same order as headed sections. Move a
headed section before or after the unnamed group to change their relative order;
the unnamed group's row layout and navigation remain unchanged.
Mark fixed account/workspace selectors or other controls inside Content with
`pinned`; pinned sections have no drag handle or drop target, retain their DOM
slot, and their keys are ignored in stored orders. Header, Primary, and Footer
slots remain outside the reorder region.
Keep these sections as direct resolved children of `ViewSidebar.Content`;
fragments, conditional children, and components returning a section are supported.
Nested disclosure groups remain contents of their owning section, not separate drag targets.

The shared app drag provider supplies isolated scopes for each sidebar instance.
Drag a section header with the mouse, or Tab to its Reorder control and use
Up/Down. Header action buttons keep their normal behavior. Touch retains normal
scrolling and collapse behavior without section dragging. The shared handle,
drop indicator, reorder math, and layout animation also serve Chat; Chat retains
its own preference storage.

Order is local to the account and view (`sidebar-section-order:<view>:<account>`).
Open splits and tabs of the same account/view synchronize through storage
notifications; account/view changes retire their previous listeners.
Storage is schema-validated through `makePersistedState`; unavailable storage
leaves in-memory ordering usable. Unknown keys are ignored and new sections stay
in their default slots. Temporarily hidden sections retain their saved positions.
Pinned controls and footer controls do not move. Sections move
as existing DOM nodes, not CSS `order`, preserving input state and reading order.

## Navigation layout

Desktop multi-split close controls live in the outer frame corner. The inherited split controller sets `closeButtonPlacement` to `frame` to suppress duplicate header/sidebar close buttons; touch layouts retain header placement.

Automatic navigation closure after the first measurable layout keeps the docked
Resize panel mounted while its width closes over 140ms. The initial layout,
including a view becoming measurable after mounting at zero width, settles
without motion. Main expands alongside later sidebar closures without writing
the saved wide preference. An explicit overlay opening or required navigation
takes priority over the exit, and a quick return to wide reuses the docked panel.
A single host phase (`docked`, `closing`, or `overlay`) controls mounting.
Breakpoint transitions own host changes; pin changes only animate the active
host and do not cancel a pending narrow exit.
Reduced-motion and browsers without WAAPI switch hosts immediately.

A view whose aside is its entity list (Notifications, desktop Chat) passes
`asideList`.
Narrow, it bypasses the overlay: the list fills the shell over an inert Main
until `open`, then Main fills it and `ViewNavigationControls` shows Back,
calling `onBack`, in place of Show navigation. The list stays mounted, hidden
and inert, so it keeps its scroll, and takes focus when Back returns to it.
Collapse controls and `Cmd+.` are off there; wide layouts are unchanged.
`aside.fillsShell()` is true while the list fills the shell, so a list that
follows the keyboard into a preview can wait for Enter instead.

`ViewBreadcrumbs.Outlet` accepts `activeItem` to replace the current breadcrumb
with a title control while retaining parent navigation. `EntityDetailTopBar`
uses this slot for its title menu; appending the title as outlet children would
render the same entity twice.
Workspace layouts share a 720px container breakpoint. Desktop navigation docks
above it and overlays below it, in every split: only that breakpoint hides it
automatically. A split other than the first starts with navigation shown and
keeps its own Hide/Show choice across the views it shows; only the first split
reads and writes the saved preference. Wide touch has two compositions:

- A list aside (Chat, Agents, Notifications) stays left of its detail.
- A collection (Mail, Drive, Tasks, CRM, Calls, Reviews) passes
  `contentLayout="collection"`. Its list stays left and its empty or selected
  preview stays right. The leading **Show sidebar** control opens the existing
  sub-view navigation in `NavigationSheet`, built on `MobileDrawer`. The sheet
  slides in from the left and covers the list's exact bounds, leaving the
  preview's layout unchanged. It follows viewport and pane geometry changes.

Use `CollectionPanes` with the host's `list`, `hasDetail`, and detail children.
It owns one pair of resize frames and pane-scoped floating regions; breakpoint
changes preserve the mounted detail/editor. The list stays mounted while wide
selections or the navigation sheet change. Replacement layouts without swipe
back unmount their hidden list to retire its keyboard handlers.
Hosts continue to own queries, selection, route admission, and loading states.
Mail retains its custom desktop reading pane and uses `CollectionPanes` on
touch. It normalizes touch resizing into its existing reading-pane width
preference's desktop units.

Pass `onBack` when a collection detail can return to its list. At narrow touch
widths, the list stays mounted and inert underneath the detail. The detail's
`ViewShell.TopBar` offers Back, and a rightward swipe from the left edge slides
the detail over the list using the mobile split motion. A canceled swipe
settles back onto the detail. Completing the motion invokes the host's return
action within the current workspace.

Sheet visibility is temporary and independent of the saved desktop sidebar
preference. `ViewSidebar.Item` dismisses a sheet after destination activation;
disclosure controls keep it open. Focus returns to the registered list trigger.
The sheet occupies no resize track and does not resize or remount the list or
preview. Detail headers add no sidebar trigger; floating channel headers keep
their measured local chrome.

On touch, `ViewShell.TopBar` inside `ViewShell.Main`, `ViewShell.Detail`, or a
`CollectionPanes` detail floats over the pane as mobile chrome, like the split
header of a standalone view. Wrap its title in `ViewShell.TopBarTitle`, its
trailing actions in `ViewShell.TopBarActions`, and a lone leading control such
as Back in `ViewShell.TopBarIsland`;
each becomes an island on touch and renders inline on desktop. The pane reserves
the bar's measured height as `--mobile-content-inset-top` and fades content
beneath it. A bar nested in a hosted detail stacks below the bars before it.
Content under a bar that does not float (no enclosing pane) keeps resetting the
inset; check with `useTouchTopBarsFloat`.

A detail whose standalone view has a split header shows that same header in a
touch preview. The host wraps the pane in `SplitHeaderScope.Root` and renders
`SplitHeaderScope.TopBar`; the detail fills that bar as it fills its own
split's header. A detail with a mobile view renders it, and its `MobileHeader`
lands in the bar: `HostedMarkdownHeader` (`MobileMarkdownHeader`) for documents
and tasks, `MobileEmailThread` for Mail threads, `MobileAgentSessionHeader` for
agent sessions. Those views read the item from its feature context, not from a
legacy Block. Details not yet split contribute through `SplitHeaderLeft`,
`SplitHeaderRight`, and the title file menu (`FileSplitHeader` for Drive files,
`PrSplitHeader` for pull requests). `entityDetailHostsSplitHeader`
lists the detail types that do; add a type there once its detail renders its
standalone header without a Block. It does not say which viewer a document
opens in: `entityDetailOpensMarkdown` does (notes, tasks, snippets and skills
in `MarkdownDetail`, files in their own detail), for `EntityDetail` and hosts
that wrap a detail themselves. A `SplitHeaderScope.Root` that is off hides
any enclosing scope from its content, so `useSplitHeaderScope` answers for the
nearest host only. Inline block previews (`PreviewFrame`) use the same scope.

Project routes inside Tasks and mobile task details use `SplitHeaderScope.Pane`,
which composes the root, top bar, and filling content area, so the collection pane
measures its own islands instead of inheriting an unrelated outer split header inset.
The project pane retains the shared split Back action, including history and direct-link fallbacks, instead of adding a sidebar toggle beside it.
A top bar's `navigation` slot replaces its automatic controls when a host supplies its own leading action.
Touch collection navigation uses the global modal sheet at every width so its
surface and backdrop cover floating list controls and app chrome. On narrow
layouts it takes three quarters of the screen, at least 256px, capped by the
workspace.
Narrow touch item routing is unchanged, including Chat's full-frame feed without
a sidebar control. Wide touch retains the desktop 1px list/detail dividers.

`ViewShell.Main`, `ViewShell.Detail`, and `CollectionPanes` frames scope floating
mobile accessory chrome to their pane through `FloatRegionScope`. The app-wide host follows the winning
contribution's pane as navigation collapses or resizes; editors remain mounted.
The navigation dock and app-wide overlays keep their global placement.

`MobileListLayout` owns floating touch collection controls, measures their height,
and paints the top fade only inside that list pane. Outer wide-touch collection
headers use a 24px left gutter to clear rounded screen edges, retaining the
standard 12px right gutter; narrow and nested headers keep their usual spacing.
Reserve its
`--mobile-content-inset-top` within the scroller (for `ListViewport`, opt into
`touchInset`). Nested activity controls add their height to the parent inset;
desktop headers stay in flow. Keep workspace metadata composable on touch when
its chrome is local, so the legacy split-wide fade does not cover the sidebar.

Docked touch sidebars above the layout breakpoint use 1.57421875 times the base width
and bounds (403px initially), and preserve that width while space permits.
Desktop and narrow overlays keep base sizing. Normalize manually resized touch
widths before saving so switching layouts or devices does not compound scaling.
A docked touch sidebar is the view's list, as on a phone, so it has no title or
collapse toggle: `ViewSidebar.Header` renders only the top safe area there.
Sheets and overlays keep their header.
