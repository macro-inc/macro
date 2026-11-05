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

A view whose aside is its entity list (Chat, Notifications) passes `asideList`.
Narrow, it bypasses the overlay: the list fills the shell over an inert Main
until `open`, then Main fills it and `ViewNavigationControls` shows Back,
calling `onBack`, in place of Show navigation. Collapse controls and `Cmd+.` are
off there; wide layouts are unchanged.
