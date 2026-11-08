# Lexical WASM view

## What it is

Production browser rendering and input over document_session_wasm. The dev shim
shares this view through EditorPort; it does not supply production model code.

## Boundaries

- The Diff applier owns mirror writes; renderers and view plugins read it.
- A successful flags=0 TextFromView may acknowledge exactly the submitted edit
  through that applier. Authoritative Rust corrections take precedence.
- Debug builds compare mirror text with Rust node text after every TextFromView.
- Keep lexical and @lexical packages out of the production dependency graph.
- Retarget copied DOM code from Lexical 0.45.0; preserve its MIT notice and pin.
- Keep HTML import and code highlighting off the startup path.

## Checks

- `bun run check`, `bun run test`, `bun run test:browser`
- Browser tests launch their own headless Chromium; never connect to a person's
  browser or the shared CDP instance. No existing-server reuse.
- Build document_session_wasm before session browser tests, with TMPDIR and -j4.
- `just check`, `just pr-privacy`

## Related

S12 section 1 in the port specs; packages/collaboration/src/session for execution
and the generated ABI; packages/lexical-core for retained source node behavior.
