# SDK documentation

## Start here

- `src/render.ts`: the shared TypeDoc conversion and Markdown/HTML outputs.
- `scripts/generate.ts`: reference generation, build-only mode and stale-output check.
- `reference/`: checked-in TypeDoc Markdown; regenerate when SDK source changes.
- `README.md`: local documentation preview commands.

## Scope

- Owns the public SDK reference and static documentation worker.
- SDK behavior and source comments belong in `../sdk`.
- Consumers may package canonical Markdown; keep Deno bundles, tool catalogs
  and backend artifacts in their own build packages.

## Checks

- `bun run type-check`
- `bun run generate` updates the checked-in Markdown after SDK changes.
- `bun run test` renders fresh build outputs, checks the reference without
  rewriting it, and tests linked public contracts and stale-output detection.
- `bun run docs:dev` serves the generated HTML for browser verification.

## Gotchas

- `reference/` is generated and committed; `dist/docs/{markdown,html}` are
  ignored build outputs. Edit the SDK source, not generated pages; retain links
  to generated API request/response types. Never regenerate the reference before
  checking it in CI, because that hides stale documentation.
- Wrangler uses build-only mode so preview and deployment never rewrite `reference/`.
- TypeDoc and its Markdown plugin must use the same TypeDoc runtime instance.
  The workspace also contains other versions; preserve the peer resolution in
  `src/render.ts` and test actual generation after dependency changes.
- Use TypeDoc's reflection and Markdown plugin for signatures and visibility;
  do not add a separate TypeScript declaration parser.
- Keep `expandObjects` enabled so object alias declarations show concrete fields.
- `CLAUDE.md` is a symlink to this guide.
