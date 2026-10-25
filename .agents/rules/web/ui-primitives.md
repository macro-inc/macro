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
