---
description: "Components, styling, and interaction conventions."
paths:
  - "**/*.tsx"
globs: "**/*.tsx"
alwaysApply: false
---

# UI conventions

Components, styling, and interaction conventions.

- **FE-22** Pending or permission-gated actions render as a dimmed version of
  the real UI with inline accept/reject controls — not a generic placeholder
  icon.
- **FE-23** Disclosure carets rotate 180° to point down when expanded, matching
  Discussion, SplitFileMenu, CollapsibleMessage, etc.
- **FE-24** Truncated/collapsed controls get a tooltip (matching the app's
  tooltip pattern) so the lost label stays discoverable.
- **FE-25** Semantic color tokens, not raw Tailwind palette classes — the
  default palette is disabled via `--color-*: initial` in
  `apps/web/src/index.css`, so classes like `text-red-500` silently render
  nothing. Enforced by ast-grep `tsx-no-raw-tailwind-palette`, CI error.
- **FE-26** Prefer composition over configurability; keep reusable components
  small and free of queries/complex state.
- **FE-27** Don't add `cursor-pointer` to clickable elements. Enforced by
  ast-grep `tsx-no-cursor-pointer`, warning.
- **FE-28** Dialogs rely on Kobalte's default autofocus: make the intended
  target the first tabbable element and preserve focus ownership for
  restoration. Override `onOpenAutoFocus` only for a proven lifecycle
  requirement, and verify `document.activeElement` after both opening and
  reopening in the live app.
- **FE-30** Never hoist Tailwind class strings into named constants (`const
  DAY_CELL_CLASS = '...'`) — shared markup+styling is a component; a class
  string can't carry structure, props, or behavior. Extract a component, or
  inline the literal at its single use; styling variants are component props,
  not exported strings. Enforced by ast-grep `tsx-no-class-string-consts`,
  warning.
- **FE-32** Prefer styling in the component (Tailwind on the markup). Reserve
  `@utility` in `apps/web/src/index.css` for styles widely shared across many
  components — not one-off or two-callsite layouts.

## Components

- Prefer composition over configurability. Follow slot-based patterns (see
  src/features/channel, src/features/entity, or Kobalte).
- Keep reusable components small, atomic, and decoupled from queries/complex
  state. Push data-fetching and mutations up to use-case-specific composed
  components.
- Context should be scoped to a component subtree — Message.Content consuming a
  MessageContext is fine because the ownership boundary is clear.
- Composed primitives must not depend on use-case-specific context — a
  RecipientsSelector should never require an EmailComposeContext.
- New features and feature restructures use the layered layout in
  [docs/architecture/frontend-features.md](../../../docs/architecture/frontend-features.md),
  summarized by FE-33 (`core / queries / primitives / components / views` plus
  an injected `context/`). Keep production wiring in an app-facing entry point
  and give reactive logic narrow feature-owned contracts.
  `src/features/activity` illustrates the layers but still has documented
  composition and contract migration gaps.
- **FE-53** Use the shared components in `apps/web/src/components/ui` (`@ui`)
  whenever one fits; browse them at `/app/component/ui`. Don't build a one-off
  button, dialog, menu, or input. A missing primitive is added there, with a
  `*.docs.tsx` page and tests, not inside a feature.
- **FE-54** Decide mobile behavior deliberately. Unless the change makes it
  obvious, ask the user how a UI change should look and behave on mobile, then
  follow [`mobile.md`](mobile.md).
- **FE-55** UI tests drive real interactions (click, type, keyboard, focus)
  through `@solidjs/testing-library` and assert what the user sees or can do.
  No tests that only render and check classes, snapshot markup, or mock the
  component under test; cover full flows with browser tests.
