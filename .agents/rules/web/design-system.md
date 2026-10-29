---
description: "Controls come from one component per role, at one height per bar, with one selected state, styled only by their own props; overlays share two surfaces."
paths:
  - "apps/web/src/**/*.tsx"
globs: "apps/web/src/**/*.tsx"
alwaysApply: false
---

# Compose controls from the design system

The app looks inconsistent when a surface invents its own switcher, frames
tabs as actions, or resizes a control from the outside. Like Linear, every bar
uses the same few controls in the same places, so a new surface looks right by
construction. Browse them at `/app/component/ui` (Foundations → Controls).

| Role | Use | Never |
| --- | --- | --- |
| Switch a view, section, or one of a few values (`wrap` for separate preset chips in forms) | `Tabs` (desktop pill within a pill) | Buttons, a ButtonGroup, or an island acting as tabs |
| Tabs that own panels or a dynamic collection (tables, form pages, rename, add) | `TabSelector` (`Root`, `List`, `Tab`, `Panel`, `AddMenu`) | `@kobalte/core/tabs` in a feature |
| Related header actions (filters, view options, sharing, navigation) | `HeaderActionGroup` | A hand-built bordered row |
| One on/off toggle, or an icon-only layout choice | `Button` with `aria-pressed` | A custom active tint |
| Many options, or header tabs that no longer fit | `Dropdown` / `Select`, `MobileDrawer` on touch, or `Tabs iconOnly` first | Scrolling or wrapping a header tab row |
| Create, search in a collection header | `ViewCreateButton`, `ListHeaderSearch` | One-off New or search buttons |
| Text entry, search fields | `Input`, `InputGroup`, `SearchBar`, `settings-input` | A raw `<input>` with its own border, radius, or focus color |
| Menu, popover, floating toolbar or editor panel | `Dropdown`, `Toolbar`, or `menu-surface` on the overlay root | A hand-built fill, border, and shadow, or `bg-menu-glass` |
| Dialog or modal card | `Dialog`, or `elevated-surface` for a custom dialog root | `bg-dialog`/`bg-surface` with its own radius and shadow |
| Loading placeholder, view skeleton | `ListSkeleton` (`Root`, `Row`, `Bar`); `ViewSkeleton` with the view's tabs and `controls` | `animate-pulse` boxes with their own fill |

- **FE-60** Pick the component for the role from the table above, and import
  tabs only from `@ui`. Enforced by ast-grep `tsx-tabs-from-ui`, CI error; the
  Fig editor's panel tabs and the mobile share sheet's `UnderlineTabs` are the
  documented exceptions.
- **FE-61** Tabs are navigation and islands are actions: never put `Tabs` or
  `TabSelector` inside a `HeaderActionGroup` or `ButtonGroup`, and never render
  a tab as a `Button`. A split button (`ButtonGroup` with a menu trigger) is
  its own island; never nest it inside another, including through
  `SidePanel.HeaderActions`. Use `ButtonGroup.Button` for explicit segments and
  `variant="secondary" finish="raised"` for action frames; ordinary Buttons stay
  independent. Enforced by ast-grep `tsx-tabs-not-in-action-group`
  and `tsx-no-button-as-tab`, CI error.
- **FE-62** Lay out a desktop header as one row: title or breadcrumbs, then
  view tabs on the left; islands on the right in the order filters, view
  options, New, Search (detail views: entity actions, sharing, navigation,
  detail toggle). Detail-header groups use `sm` labelled segments and `icon-sm`
  icon-only segments (28px controls); Drive and Tasks list-header groups use
  `md` / `icon-md`, matching Tabs, New, and Search. Keep 8px between islands. Filter, sort, group, and download live in the header, never
  in a second toolbar row; only active filter chips sit below it.
- **FE-63** Style controls only through their props (`variant`, `size`, `finish`,
  `fullWidth`); `class` on a control is for placement (margin,
  width, order, shrink). Never resize or recolor a control from a wrapper
  (`[&_button]:size-8`); use an explicit `icon-*` size for icon actions. Put glyph
  sizing on the rendered icon, not on Button or ancestor SVG selectors. Enforced
  for wrappers by ast-grep `tsx-no-descendant-button-styles`, warning.
- Use `variant="primary"` for the main create, save, submit, invite, approve, or continue action. Primary is solid neutral: black with white text in light themes, white with black text in dark themes. Keep existing primary consumers on `primary`, including selected-state controls. Use explicit `variant="accent"` only for separately intended theme-color emphasis. Home/AI chat, channel, and email Send actions use the shared primary `SendButton`. Keep the shared New launcher (`ViewCreateButton`) on `variant="secondary" finish="raised"`, and retain secondary, outline, ghost, and danger variants for their own roles.
- Quiet Back, Close, Cancel, and unframed inline utility actions use explicit `variant="ghost"`; omitting the variant opts into solid neutral primary emphasis, not accent. Keep intentional framed groups and selected-state actions in their own variants. Size every rendered glyph explicitly, including children passed through action wrappers; Button does not size descendant SVGs.
- Selected reaction chips are a deliberate local exception: `ReactionChip` uses `appearance="bare"` with accent-tint, accent-text, and overlay classes to preserve its soft selected treatment without a new Button variant. Keep unselected reactions on `secondary`.
- Property side-panel pin and add-value actions use standard ghost Buttons at 24px with 16px glyphs and extra-muted resting ink; remove actions use `variant="danger-ghost"` for a transparent resting face, failure-colored ink, and shared danger hover/pressed tokens. Retain shared hover tokens, not `appearance="bare"` or custom surface-hover fills. Keep pin and add-value actions visible; reveal remove and secondary row actions on hover or keyboard focus and keep them available on touch. Place add then pin with no gap between them; secondary actions follow this pair. Without add, keep pinning at the right edge after removal. Pinned glyphs use accent ink; suppress only the resting pressed fill, retaining the ghost hover token and toggle semantics. Keep editor focus restoration on value triggers, not row actions.
- Current application Button usages trial `secondary` instead of `outline`, including shared wrappers and groups. Keep the outline API and canonical Button gallery examples; do not change outline variants on badges, inputs, or other components.
- Settings actions that previously used inverse-filled `cta` styling use explicit `variant="primary"`, including creation, runtime setup, billing, invitation, and signature-save actions. Keep existing accent, ghost, and destructive actions in their own roles; do not recolor Button descendants from `SettingsPage`.
- Primary, accent, secondary, danger, and success Buttons and ButtonGroup frames automatically use the raised desktop finish and shared glass on touch. Use `finish="flat"` to opt out or `finish="raised"` to frame a ghost/link action. Outline variants, bare controls, and grouped segments always stay flat.
- Follow the [Button and ButtonGroup contract](ui-primitives.md#button-and-buttongroup)
  for accessible names, tooltips, sizing, explicit segments, and activation behavior.
- **FE-64** Components own their state treatments: desktop Tabs share a flat rounded track with an inset selected pill;
  Button uses the semantic pressed fill for its variant. Mark action toggles with
  `aria-pressed`, and expansion triggers with `aria-expanded`. A toggle whose
  label and icon flip with its state (call mic and camera: Mute/Unmute) omits
  `aria-pressed` and keeps one fill. Do not restyle
  buttons as tabs. The agent composer's Auto/Chat/Code switch remains
  `Tabs variant="track"`, a flat pill sliding along the composer's tray. Keep all
  tab treatments flat: use borders and selected fills, not raised edges, gradients, or shadows.
- **FE-65** Let `Tabs` own its touch styling: set its `touch` prop instead of
  swapping tab components or variants. For overflowing touch header sections,
  use a shared `MobileDrawer` selector instead of a scrolling tab strip.
- **FE-66** Single-line inputs are pills at the control heights, like Buttons:
  build them from `Input`, `InputGroup`, or `SearchBar` (`settings-input` in
  settings rows). Filter chips use the same frame (pill, `edge-button` border,
  control fill) with `overlay-*` hovers, never raw `ink/5` tints.
- **FE-67** Overlays share two surfaces: menus, popovers, floating toolbars, and
  editor panels use `menu-surface`; dialogs use `Dialog` (`elevated-surface`).
  Never give overlay content its own fill, border, or shadow, and never paint a
  fill on a child that reaches the overlay's edge: it covers the dark-mode bevel
  (`menu-surface`'s inset edges). On a `Surface` or
  `Panel`, pass `hideBorder` and keep `rounded-xl bg-surface` (core utilities
  outrank `@utility` classes). Enforced for Kobalte `.Content` and
  `bg-menu-glass` by ast-grep `tsx-overlay-canonical-surface`, CI error; the
  reply composer, mobile drawer, call controls, and fullscreen media viewers
  are the documented exceptions.
- Reuse the same styled items and padded groups for dropdown and context menus; vary only their root, trigger, and content composition.
- **FE-68** Loading placeholders use the shared shimmer: `ListSkeleton.Bar`
  (a pill; pass size and radius) or `skeleton-shimmer bg-skeleton`. A view's
  skeleton is built from `ViewSkeleton` and mirrors its header (title, view
  tabs, and header controls as placeholders), so change the skeleton in the
  same change as the header. Enforced for pulsing boxes by ast-grep
  `tsx-skeleton-shimmer`, CI error.

Check: `just check` passes the ast-grep rules; the changed bar shows one height,
16px icon glyphs, tabs on the left, and islands only around actions, at desktop
width and narrowed until labels collapse; a changed overlay matches the other
menus (or dialogs) in light and dark mode.
