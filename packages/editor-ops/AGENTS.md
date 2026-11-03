# editor-ops

## What it is

Op builders for AI and SDK content editing. `DocumentEditor` turns method calls
into plain-data markdown `DocumentOp`s that ai-editing-worker's `Doc` applies.
Design: `docs/design/sdk-content-editing.md`.

## Start here

- `src/document/document-editor.ts`: the builder; its TSDoc is the reference
  agents read.
- `src/document/ops.ts`: the op vocabulary the worker applies.

## Boundaries

- Depends on nothing at runtime; type-only imports are allowed (lexical-core's
  database-query types). The SDK vendors these files and the worker's QuickJS
  bundle strips their imports, so a runtime import breaks both.
- Used by: `services/ai-editing-worker` (model sandbox, `POST /document-ops`)
  and `packages/sdk`, which vendors copies of these files.

## Recipes

- Change the builder: edit `src/document/` → `bun
  services/ai-editing-worker/scripts/generate-sandbox.ts` to regenerate the
  sandbox bundle → add the `Doc` handling in
  `services/ai-editing-worker/src/ai-editing/doc/doc.ts` for a new op kind.

## Checks

- `bun run --cwd packages/editor-ops type-check`
- `bun run --cwd packages/editor-ops test`
- `bunx @biomejs/biome ci .` from this directory.

## Gotchas

- Published SDKs and the deployed worker can differ: only add op kinds; a
  changed meaning needs a new kind.
