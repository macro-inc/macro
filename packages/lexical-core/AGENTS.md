# Lexical core

## What it is

Shared Lexical nodes and Markdown conversion for web editors, message renderers,
and backend document transformations.

## Start here

- `transformers/index.ts`: internal, external, and combined import/export sets.
- `utils/auto-link.ts` and `transformers/auto-link.ts`: shared URL matching and
  its adapter to Lexical's inline importer.
- `README.md`: persisted link and explicit-unlink behavior.

## Boundaries

Keep runtime code independent of the web app and browser-only modules. The web
composer imports the URL matcher from this package; do not duplicate it.

## Checks

- From `apps/web`: `bun run test --project lexical-core`.
- Run `bunx @biomejs/biome ci <changed-files>` from this directory for its
  format/lint rules; include untracked files before the first commit.
- Link changes also run `bun run test --project core linksPlugin.test.ts
  StaticMarkdown.test.tsx` in `apps/web`, and the browser check documented in
  `apps/web/src/lib/core/component/LexicalMarkdown/component/core/browser-test/README.md`.

## Gotchas

Human user mention Markdown requires only a nonempty string `userId`; the importer
derives a missing email from `macro|` IDs so web name lookup and clipboard round
trips can resolve the user. Other identities still need an email or display name.

Keep URLs protected from inline formatting during import; matching rendered
text is too late. Preserve code, mention payloads, existing links, and escaped
literal URLs. Keep unlink state through both Markdown and Lexical JSON saves.
`NodeReplacements` must copy `ListNode` start when wrapping as `TaskListNode`;
dropping it resets every typed `6.` marker to `1.`

An image under a list item is a child of that `ListItemNode`. Lexical runs
element transformers only on top-level nodes, so `listItemImage` exports it as
an indented line, and the image importers attach an indented image line after a
list to its last item. Add it to any new transformer set that has image
transformers.

Creation-time markdown snapshots write explicit root pins as `pending:<definitionId>`; omit initial pins to preserve the blank golden snapshot and implicit defaults.
