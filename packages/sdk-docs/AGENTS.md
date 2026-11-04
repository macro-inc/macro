# SDK documentation

## Start here

- `src/render.ts`: the shared TypeDoc conversion and Markdown/HTML outputs.
- `scripts/generate.ts`: renders Markdown and HTML into ignored `dist/docs/`.
- `README.md`: local documentation preview commands.

## Scope

- Owns the public SDK reference and static documentation worker.
- SDK behavior and source comments belong in `../sdk`.
- Consumers may package canonical Markdown; keep Deno bundles, tool catalogs
  and backend artifacts in their own build packages.

## Checks

- `bun run type-check`
- `bun run test` renders fresh build outputs and tests linked public contracts.
- `bun run docs:dev` serves the generated HTML for browser verification.

## Gotchas

- Nothing generated is committed: `dist/docs/{markdown,html}` are build
  outputs. Edit the SDK source; retain links to generated API request/response
  types.
- TypeDoc and its Markdown plugin must use the same TypeDoc runtime instance.
  The workspace also contains other versions; preserve the peer resolution in
  `src/render.ts` and test actual generation after dependency changes.
- Use TypeDoc's reflection and Markdown plugin for signatures and visibility;
  do not add a separate TypeScript declaration parser.
- Keep `expandObjects` enabled so object alias declarations show concrete fields.
- `CLAUDE.md` is a symlink to this guide.
