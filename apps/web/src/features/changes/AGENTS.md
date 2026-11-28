# Shared Changes viewer

## Start here

- `README.md`: host contracts, layout ownership, and lifecycle boundaries.
- `changes.tsx`: shared provider and pane exports.
- `agent-session-changes.tsx`: production agent-session adapter.
- `context/changes-context.ts`: injected source and host capabilities.
- `primitives/create-changes.ts`: controller construction.

## Scope

- Owns the reusable changes controller and agent-session sliding pane.
- PR-specific Overview/Changes tabs belong to `features/block-pr`; do not change
  the agent-session pane to implement PR-only layout.
- Keep diff rendering and annotations in `components/diff-view`.

## Gotchas

- Keep host scope keys stable so layout, collapse choices, and notes stay isolated.
- Preserve displayed patches and diff owners through pane exit and layout changes.
- Do not infer missing GitHub totals from captured patch totals.
- Read `README.md` before changing animation or drawer lifetime boundaries.

## Checks

- From `apps/web`, run `bun run test -- src/features/changes src/features/block-pr`.
- Run `just check`; run `just check full` before a PR.
- Keep browser checks delegated when the user requests no browser automation.
