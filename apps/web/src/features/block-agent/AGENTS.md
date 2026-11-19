# Agent sessions

## Composer boundaries

`ui/AgentInput.tsx` is the standalone session composer. The host owns uploaded
attachments and sends; library context stays in the draft as mention nodes.

Use `@core/component/AI/primitives/create-composer-item-drop` on the visible
composer surface for app-item drops. Keep native file uploads on their existing
path and never move or clear the source selection when adding context.
Forward the drop primitive's `onConnect` through `ComposerEditor`; do not resolve `editor.lexical` while constructing the drop target.

## Checks

From `apps/web`:

- `bun run test src/features/block-agent`
- `bun run type-check`
