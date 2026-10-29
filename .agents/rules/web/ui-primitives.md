---
description: "Shared UI primitives keep Kobalte semantics, semantic tokens, a gallery page, and tests."
paths:
  - "apps/web/src/components/ui/**"
globs: "apps/web/src/components/ui/**"
alwaysApply: false
---

# UI primitives

Applies to `apps/web/src/components/ui`, including ports from shadcn-solid.

- Use the upstream structure and behavior as a starting point, then reshape
  exports to match the local slot-based, compound-component API.
- Replace upstream palette, surface, border, and status classes with the
  existing semantic tokens; inputs normally use `bg-input`, `border-edge-muted`,
  `text-ink`, and `text-ink-placeholder`.
- Preserve Kobalte semantics, state attributes, and polymorphic prop types. Keep
  accessibility relationships inside the primitive instead of recreating them at
  call sites.
- Add a co-located `*.docs.tsx` gallery page and focused `*.test.tsx` coverage
  for every ported component.
- A primitive owns its look on desktop and touch. Expose role and size props
  (`variant`, `size`, `fullWidth`, `iconOnly`) and typed values, not class hooks
  into its parts (`itemClass`, `labelClass`); `class` places the root.
- Before adding a control, check the roles in
  [`design-system.md`](design-system.md); extend the component for that role
  instead of adding a second one.
- Keep `Input` a thin native control. Use `InputGroup` for icons, clear actions,
  inline Buttons, and shared ButtonGroup framing instead of adding composition
  props to `Input`.
- In `InputGroup`, keep the input as the single control and place surrounding
  content in `Addon` slots. Use `align` for visual placement so accessible DOM
  order stays independent of layout.

## Button and ButtonGroup

- Keep the shared `Button` and `@ui` import; migrate callers directly instead of
  adding parallel implementations or legacy-prop adapters. The role and variant
  policy lives in [the design system rule](design-system.md).
- Buttons perform actions; navigation uses anchors. `variant="link"` changes
  appearance, not semantics.
- Name icon-only actions with `aria-label`. Tooltips are independent: use a string
  or `{ content, placement, disabled, hotkey, shortcut }`. Do not restore `label`,
  root-level `hotkey`/`shortcut`, `square`, `depth`, `glass`, or `noTouchResize`.
- Use `xs` through `xl` for labeled actions and `icon-xs` through `icon-xl` for
  square actions. Shared minimum heights are 24/28/32/40/48px; labeled controls
  can grow with their content. Preserve the 36px touch minimum and size rendered
  glyphs separately. Composer Send, microphone, and attachment controls use
  `icon-md`, with 20px desktop and 24px touch glyphs.
- Keep ordinary children in the Button's flex row so trailing carets, truncation,
  and custom spacing work. Only loading actions need the reserved-content layer.
  Preserve native disabled behavior and activation guards for polymorphic controls.
- Compose groups explicitly with `ButtonGroup.Button`; standalone Buttons do not
  inherit group styling. Segments inherit size and variant unless overridden,
  remain flat, and own their hover/pressed/disabled states. The frame owns its
  material once, without a whole-group hover treatment. Group labels use
  `aria-label`; `CopyButton` joins with `as={ButtonGroup.Button}`.
- Keep `aria-expanded` on disclosure controls without treating expanded content
  as a selected action. Button highlights an open popup only when the same
  trigger has `aria-haspopup`; use `aria-pressed` for genuine action toggles.
- Keep Button's visible focus outline suppressed in ordinary color modes and
  retain its forced-colors indicator. Do not remove other controls' focus styling.
- Keep Tooltip's assembled and compound APIs on the same implementation and
  clean up closed or detached popups. Do not add document-wide mutation observers
  to track individual triggers.
- Keep materials in `src/index.css`; JavaScript only derives accent text contrast
  and the corresponding state-mix direction. Reset runtime material assignments
  at theme boundaries so previews resolve their own palette. Do not persist
  derived Button tokens in authored theme data.

## Selection controls

- Use `Checkbox` for independent values, `RadioGroup` for one choice among values,
  and `ToggleSwitch` for a setting that takes effect immediately. Retain their
  native inputs, accessible labels, controlled/uncontrolled state, and keyboard behavior.
- Keep unchecked checkbox and radio faces transparent. Checked and indeterminate
  controls use the accent fill. Checkbox marks and radio indicators share the
  accent Button's `button-accent-ink` token.
- Set checkbox/radio size on the root: `sm` is 14px, `md` (default) is 16px,
  and `lg` is 20px. `ToggleSwitch` tracks use `xs` 28×14px, `sm` (default)
  32×16px, and `md` 40×20px. Do not resize internal SVGs or override selection
  colors from callers or enclosing pages; checked controls use the theme accent.
- Switch thumbs stay fixed white in both states and every theme, with a secondary border.
  Only the track changes to the theme accent when checked; do not apply accent-contrast to the thumb.
  Use the shared `ToggleSwitch` for code-preview controls instead of separately styled Kobalte parts.
- Render `Checkbox.Control` or `RadioGroup.ItemControl` once per value; each
  includes its native input and default indicator. Do not add a second Input slot.
- Use `InlineCheckbox` only as an aria-hidden decoration for an interactive row
  or selection control that owns selection, focus, and input semantics. Entity
  list selection uses it inside `MultiSelectCheckbox` to retain shift-click and
  full-cell hit targets. Single-select menus retain their trailing
  `SingleSelectCheck`, not a checkbox.
- Keep checkbox draw/retract and switch press motion CSS-only and respect reduced
  motion. Preserve selection-control focus indicators independently of Button styling.
