# Macro UI system proposal

Status: proposal for review, September 24, 2026. This document describes the next
design system; it does not claim the current app already follows these rules.

## The short version

Macro has two materials: **flat** and **elevated**. Choose a component by its job,
then let the component own its appearance.

1. Pages, both sidebars, and split panels share the theme's near-black base.
2. Action buttons, tabs, and utility fields use the filter button's flat gray
   fill and continuous border. This includes Save, Send, Create, and icon buttons.
3. Navigation, list rows, and menu items use quiet selection: a subtle fill and
   brighter text or icon. Their HTML element does not determine their styling.
4. Dropdowns, context menus, selects, and autocomplete panels are flat, opaque,
   and bordered.
5. Modals, Cmd+K, email bodies, and message composers use the shared elevated
   material: a soft rim and shadow. This includes AI, email, channel, and comment
   composers.
6. Every single-line field is a pill. Multiline utility fields are rounded
   rectangles; message composers retain their elevated frame as they grow.
7. Focus brightens the field's edge. Keyboard focus is always independently
   visible, including on selected items.
8. Unread is a small earthy-green dot. It is independent of current selection.
9. Group dividers are quieter than frame borders. They have separate tokens.
10. Feature code chooses role, size, and state. Shared components and theme
    tokens choose color, border, radius, shadow, and interaction treatment.

## Choose the role

| Role | Examples | Resting treatment | Interaction |
| --- | --- | --- | --- |
| Structure | Main canvas, outer rail, inner sidebar, split panel | Base fill; a frame border where regions meet | No elevation |
| Control | Filter, Create, Save, close button, tabs, search, form fields | Flat control fill and frame border | Brighter hover/press fill; focused fields get a lighter edge |
| Selectable item | Sidebar link, email row, file row, command result, menu item | Clear background or inherited container fill | Quiet neutral selection; stronger ink; no shadow |
| Menu | Dropdown, context menu, select list, autocomplete, picker | Opaque flat fill and frame border | Selectable-item treatment inside |
| Elevated work surface | AI/channel/comment/email composer, email body, Cmd+K, Create or other modal | Shared elevated fill, rim, and shadow | Editable areas brighten their frame on focus |

The same role has the same treatment on every page. A menu remains flat when
opened from a modal. A button remains flat when placed in a composer.

### Resolve common ambiguities

- **A sidebar link rendered as a button is still navigation.** It gets the quiet
  selected state, not a boxed action-button treatment.
- **A tab is a control.** Tabs keep their frame and fill; the selected tab becomes
  slightly brighter. This differs deliberately from selectable sidebar rows.
- **A trigger and its menu are separate roles.** The filter trigger is a button;
  the popup is a menu; the options are selectable items.
- **An email row and its body are separate roles.** The current row becomes
  slightly brighter. The opened message body gets the elevated material.
- **A search field and a composer are separate roles.** Search, title, recipient,
  and settings fields are flat. An area for writing a message is elevated.
- **A command palette is a modal.** Its outer shell is elevated. Search and
  result rows inside use their normal field and selection treatments.
- **Prominence does not require another material.** Use placement, a clear label,
  and stronger ink/weight for the main action. Ordinary actions share the same
  neutral button family. Destructive actions add semantic red ink and explicit
  wording while retaining the same frame.

## Theme and borders

Keep the current Macro dark base and relative gray ramp. The theme currently
starts at `oklch(0.17 0 21deg)`, slightly above black, and derives brighter layers
by mixing toward the foreground. Keep those relationships in the theme.

Components consume semantic aliases, not hardcoded grays or arbitrary layer
depths. Light mode uses the same roles with theme-specific values.

| Semantic token | Purpose | Proposed starting value for dark mode |
| --- | --- | --- |
| `page`, `panel` | All structural backgrounds | Existing `surface-0` |
| `control`, `menu` | Flat controls and opaque menus | Existing `surface-2` |
| `elevated` | Base fill beneath the shared rim and shadow | Existing composer fill |
| `border-frame` | Panels, buttons, fields, menus | Foreground at 8% opacity over its local fill |
| `border-divider` | Group and internal separators | Foreground at 4% opacity over its local fill |
| `border-focus` | Focused field edge | Foreground at 40% opacity over its local fill |
| `state-hover` | Hover overlay | Existing 3% foreground overlay |
| `state-current` | Current list row or pressed control overlay | Existing 6% foreground overlay |
| `state-checked` | Explicit multiselection | Existing 8% accent overlay plus checkmark |
| `accent` | Unread and intentional semantic state | Existing earthy green |

These opacity values are **proposal values**, shown in the companion specimen,
not measurements copied from ChatGPT or Cursor. A relative frame token keeps the
same border strength on a near-black sidebar and a lighter button. It will not
produce the same absolute RGB on both backgrounds.

Use one 1 CSS-pixel frame width. Adjacent regions share one boundary. Flat frames
have a continuous edge, without a rim gradient or cast shadow. Elevated frames
have one rim; do not draw a second ordinary border around that rim.

Separate `border-divider` from `border-frame` before adjusting either. Today,
`edge-muted` serves both sidebar boundaries and group dividers, which couples
two things that need different contrast. Prefer space and a small group label
when a separator is unnecessary.

## States have specific meanings

| State | Visual rule | Semantic rule |
| --- | --- | --- |
| Hover | Small neutral fill increase and stronger ink | No layout movement or added elevation |
| Pressed | One step stronger than hover while held | Momentary pointer/key feedback |
| Current navigation | Existing quiet 3% fill, bright icon/text, filled Phosphor icon in the outer rail | `aria-current` where appropriate |
| Current list item | 6% neutral fill and stronger ink | Distinguishable from hover; selection semantics match the widget |
| Selected tab | Slightly brighter flat control fill and strong ink | `aria-selected` on tabs |
| Checked item/toggle | Checkmark or switch position; restrained accent when useful | `aria-checked` or `aria-pressed` as appropriate |
| Field focus | Continuous lighter edge around the owning field/composer | Only the field containing the focused editor lights up |
| Keyboard focus | Visible ring, also on selected controls | `:focus-visible`; focus remains visible in clipped layouts |
| Unread | Small green corner dot in the rail, consistent dot slot in lists | Accessible unread label; not inferred from color alone |
| Disabled | Muted ink and unavailable interaction | Real disabled semantics; remains recognizable |
| Invalid | Semantic error edge plus explanatory text | Associated message; preserves visible keyboard focus |

Avoid one catch-all `active` prop for current, checked, pressed, and focused.
Unread does not change an item's background. Selected state does not erase hover
or keyboard focus feedback. Focusing an inner field in a modal must not light up
the entire modal as though it were another input.

## Shape, density, icons, and motion

- **Single-line fields:** fully rounded, including search and fields inside
  dialogs. The label sits outside; it does not alter the field's silhouette.
- **Buttons and tabs:** 10px corners; the shared large icon-control size can use
  12px. Button groups own their combined outer frame and inner seams.
- **Rows:** 8px corners; outer rail selection keeps its existing 12px corners.
- **Menus:** 12px corners with a small consistent inset around options.
- **Elevated surfaces:** a shared 24px radius. A 48px collapsed composer becomes a
  capsule naturally; the same radius becomes a rounded rectangle as it grows.
- **Sizing:** use shared control-size presets. Align field and button heights
  within a toolbar. Preserve current compact density; larger touch targets come
  from the shared responsive preset rather than page-specific overrides.
- **Type and spacing:** retain Macro's current font, use the shared UI type scale
  and a 4px spacing grid. Use weight and spacing for hierarchy before adding a
  box, separator, or larger heading.
- **Icons:** Phosphor throughout, consistent weights and size presets. Regular
  by default; filled only for current outer-rail navigation or a real toggled
  state. Icon-only controls require accessible names.
- **Motion:** short color/opacity transitions, around 120ms. Hover does not move,
  scale, or elevate ordinary controls. Honor reduced-motion preferences.

The shared elevated material owns its rim, highlight, shadow, and any responsive
translucency. Pages cannot customize these independently. Use an opaque fallback
when transparency is unavailable. Measure text, control, and focus visibility
in each supported theme before shipping; the subtle decorative border is not
the only indication that a control is usable.

## Make this easy to implement

Reuse the existing component library and introduce explicit role defaults.

| Existing code | Proposed responsibility |
| --- | --- |
| Theme definitions and `index.css` | Semantic colors, independent frame/divider/focus tokens, shared material recipe |
| `Button`, `ButtonGroup` | Filter-style flat treatment by default; shared emphasis and state rules |
| `Input`, `InputGroup`, `SearchBar` | One flat pill-field frame and one focus treatment |
| `Tabs`, `TabbedControl` | Same flat control family and selected state |
| Sidebar/list primitives | Quiet current selection, hover, focus, and unread slots |
| `Dropdown`, `Select`, `ContextMenu` | One flat menu shell with shared row treatment |
| `ComposerSurface` | Composer specialization of the shared elevated material |
| `Dialog`, `ActionDialogShell`, Cmd+K | Shared elevated outer shell and standard layout |
| Email message body | Shared elevated reading surface |

Introduce a clearly named `ElevatedSurface` primitive. The existing `Surface`
component currently means a plain bordered container; changing all its callers
to glass would apply elevation to the wrong roles. `Layer` can remain an internal
implementation detail; feature code should not pick a numeric depth to restyle
a button or menu.

### Agent recipe

1. Classify the UI using the role table.
2. Use the shared component for that role.
3. Choose a documented size and semantic state.
4. Add layout/content classes only. Put reusable visual changes in the owning
   primitive or theme.
5. If a role is missing, extend the shared system and its reference examples
   before introducing a feature-specific treatment.

### Adoption order

1. Adopt the semantic tokens and maintain a small component gallery showing rest,
   hover, current, focus, disabled, and error states.
2. Unify the shared controls, fields, tabs, menu shell, and elevated shell.
3. Migrate consumers by role. Audit bespoke pickers as well as the shared
   dropdown: recipients, calendar, tags, reactions, editors, and channel menus
   currently have separate styling paths.
4. Remove local glass, shadow, fill, border, and numeric-depth overrides that
   conflict with the owning component. Restrict the elevated recipe to the
   elevated primitive.
5. Update the web agent guide with the short rules and component entry points.
   Verify Home, Mail, Channels, Tasks, Drive, Calendar, Agents, and Settings with
   the same gallery criteria, including keyboard and touch layouts.

This first step delivers the proposal and specimen. Adoption is a separate
implementation pass so the system can be judged as a whole.

## Research notes

The following were inspected through Computer Use on September 24, 2026. These
are observations of the available applications and account configuration, not
claims about every version or default theme.

| Application | Surfaces inspected |
| --- | --- |
| ChatGPT web, signed in | Work home, Chat home, existing conversation and output/source panel, search overlay, Create project dialog, Library grid and filter menu, Scheduled page, General/Appearance/Personalization settings, Images page, Plugins catalog, Explore menu |
| ChatGPT web, signed out | Home composer and attachment menu, settings, public Plugins catalog and a plugin detail page |
| Cursor desktop, Agents mode | Existing conversation and sidebar, New Chat, composer/model menu, command palette with All/Settings views, General and Appearance settings, theme dropdown, Customize MCPs and Skills, Automations |

ChatGPT was inspected in a browser because the available desktop app resolved
to a protected Codex window. Cursor's IDE/editor mode, every settings subsection,
and every feature-specific creation flow were not inspected. This is a broad
survey of shared UI patterns rather than an exhaustive page inventory.

### What carries over

- **Hierarchy comes from containers.** Composers and command palettes have clear
  outer boundaries; nested controls and result rows stay visually simple.
- **Selection is quiet.** Both products use restrained neutral rows and stronger
  text to distinguish current navigation and results.
- **Menus stay compact.** Opaque fills, thin outlines, tight rows, small group
  labels, and restrained separators provide enough structure.
- **Settings benefit from repetition.** Consistent label/description/control
  alignment and grouped rows matter more than decorating each individual field.
- **Content can carry the page.** Conversations and catalog lists use spacing and
  typography without wrapping every section in an elevated card.

There are inconsistencies in the references: Cursor's Customize tabs and
Automations tabs use different treatments; ChatGPT fields and buttons vary
between areas. Macro should use the explicit role rules above consistently.
The user's flat-button, pill-field, and elevated-work-surface requirements remain
the deciding constraints.

### Relevant source entry points

- [Default dark theme](../../apps/web/src/features/theme/themes/macro-dark.ts)
- [Shared CSS and material recipes](../../apps/web/src/index.css)
- [UI components](../../apps/web/src/components/ui/components)
- [Filter button reference](../../apps/web/src/components/view-shell/ListDropdowns.tsx)
- [Search field](../../apps/web/src/components/view-shell/SearchBar.tsx)
- [List selection and dividers](../../apps/web/src/features/entity/composed/list-entity/shared.tsx)

Research screenshots contained incidental private content and are not embedded
in this document. The companion specimen uses synthetic examples.
