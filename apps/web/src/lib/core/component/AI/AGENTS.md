# AI chat

## Scope

Legacy AI chat and shared AI-composer behavior. Home and Agents also use these
primitives; agent-session runtime behavior remains in `features/block-agent`.

## Item drops

- Use `primitives/create-composer-item-drop.ts` for app-item drops in every AI composer; keep native file uploads separate.
- Register the visible composer surface, not its editor namespace, so simultaneous composers remain independent targets.
- Pass a lazy editor accessor and wire the drop primitive's `onConnect` to `MarkdownShell.onConnect`; loading or detached editors reject drops without accessing builder getters.
- Append drop context at the draft end regardless of the retained caret; preserve source selection and reject unknown block names.
- Keep disabled, read-only and dictation surfaces ineligible for drops.

## Checks

From `apps/web`:

- `bun run test src/lib/core/component/AI`
- `bun run type-check`
