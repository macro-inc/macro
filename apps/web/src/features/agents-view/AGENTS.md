# Agents view

## Composer boundaries

`ChatComposer` serves new conversations, Home and active sessions. Session state
and sending belong to the host; the composer edits a draft and inserts mentions.

Use `@core/component/AI/primitives/create-composer-item-drop` on the whole
composer surface for app-item drops. Do not treat item rows as native files.
Keep disabled, read-only and dictation states ineligible; preserve source selection.
Keep the drop primitive's readiness hook inside the existing `MarkdownShell.onConnect` callback, alongside draft initialization.

## Checks

From `apps/web`:

- `bun run test src/features/agents-view`
- `bun run type-check`
