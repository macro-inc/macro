# Discussion entry

## Scope

Phone Discussion entry and sheet shared by projects, tasks, and company records.
The owning surface supplies `EntityConversation` presentation and permissions.

## Start here

- `discussion-preview.ts`: selects the newest root and folds loaded commenter identities.
- `discussion-entry.tsx`: presentational card and empty entry.
- `mobile-discussion.tsx`: drawer, keyboard focus, local draft, and linked-comment opening.

## Gotchas

- Keep fetching, paging, permission checks, and thread rendering in the existing conversation owner.
- Use loaded commenters for the avatar group beside View discussion; never show an overall comment count in the entry or sheet.
- Render newest-message and participant avatars through channel `SenderIcon` with `MessageProvider` and `interactive={false}`; preserve shared profile photos, bot marks, guest/imported identities, and neutral fallbacks.
- Keep surviving replies reachable even when every root message is deleted; use Start a discussion without avatars only when no messages remain.
- Center the shared icon-and-title empty state above the pinned sheet input; hide it during loading, failures, or linked-message navigation.
- Call entity conversation content messages and replies, with Add to the discussion… for the composer; preserve comment wording in anchored annotations and the legacy PR review renderer.
- Keep the composer draft when closing the sheet, and focus only after a user opens an empty discussion.
- Open at the half-height snap point with `MobileDrawer.FixedContent fitSnapPoint` and `KeyboardFooter`; drag the handle/header between half, full, and dismissed without remounting the thread.
- Expand to full height while the keyboard is open, retaining full height after it closes; reserve the translated sheet area so the pinned input remains visible.
- Never force the thread to the bottom on resize or paging; reserve that for opening, sending, and keyboard changes without a linked target.
- Keep desktop discussion inline; only phone entry compositions use this component.

## Checks

Run from `apps/web`:

- `bun run test src/components/discussion src/lib/core/messages src/components/app/mobile`
- `bun run check`

Run `just check` from the repository root. Verify phone focus, keyboard movement,
reply actions, paging, and closing/reopening against the owning surface.
