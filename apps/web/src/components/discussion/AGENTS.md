# Discussion entry

## Scope

Phone Discussion entry and sheet shared by projects, tasks, and company records.
The owning surface supplies `EntityConversation` presentation and permissions.

## Start here

- `discussion-preview.ts`: selects the newest root and folds loaded comment counts and commenter identities.
- `discussion-entry.tsx`: presentational card and empty entry.
- `mobile-discussion.tsx`: drawer, keyboard focus, local draft, and linked-comment opening.

## Gotchas

- Keep fetching, paging, permission checks, and thread rendering in the existing conversation owner.
- Show a plus suffix when more timeline pages exist; never present a partial count as an exact total.
- Show surviving reply counts even when every root message is deleted; use the empty entry only when the count is zero.
- Keep the composer draft when closing the sheet, and focus only after a user opens an empty discussion.
- Use `MobileDrawer.FixedContent` with `KeyboardFooter`; preserve the default keyboard behavior of other drawers.
- Never force the thread to the bottom on resize or page/count changes; reserve that for opening, sending, and keyboard changes without a linked target.
- Keep desktop discussion inline; only phone entry compositions use this component.

## Checks

Run from `apps/web`:

- `bun run test src/components/discussion src/lib/core/messages src/components/app/mobile`
- `bun run check`

Run `just check` from the repository root. Verify phone focus, keyboard movement,
reply actions, paging, and closing/reopening against the owning surface.
