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
- `ViewSidebar.CloseButton` shows split close only in docked navigation, never
  inside a narrow navigation overlay. Keep split-close controls out of overlays.
- `ViewSidebar.Toolbar` aligns its final `Control` with the right rail.
- `ViewSidebar.Content` owns outer gutters, 16px top/bottom padding, and section gaps.
- `Item` and `Action` own row spacing; use `Icon` for leading glyphs and
  `Trailing` for non-interactive trailing glyphs such as a create-menu chevron.
- `CollapsibleSection.Header` and `Action` align section controls on the same rail.
- `TreeItem` and `Branch` own disclosure positioning and the nested rail.
- Use `--sidebar-action-inset` for a trailing control beside a separate selectable
  row, as in Email's inbox list. Do not repeat numeric offsets in the workspace.
