# Native collector fixtures

## What it is

Source-matched production EditorSession lifetime tests using the real native
capture consumer, existing NodeHandles version finalizer and shared production
raw capture-owner registry.

## Start here

- `README.md`: artifact preparation, TypeScript and native/GC commands.
- `fixture.ts`: minimal actual lifecycle port, capture leases and raw observations.
- `retirement.test.ts`: deterministic actual native acknowledgements and failures.
- `gc.test.ts`: actual V8 GC completion and the sole NodeHandles version finalizer.
- `capture-fixture.ts`, `capture-gc.test.ts`: shared production CaptureOwners with actual NodeHandles and issued captures.

## Boundaries

- Use matching generated WASM declarations and Bebop types; never add an ambient stub or cast at this boundary.
- Keep successful native acknowledgements real; inject only collection requests or actual rejected native inputs.
- Keep native current/issued/pending and JS graph ownership guards local and truthful; do not query native state inside canCollect.
- Keep the existing version finalizer as the only producer; do not add a fixture registry or manually invoke cleanup in the GC smoke.
- Preserve all raw API/physical calls, bytes, reference slots and source/artifact hashes; never interpret a GC request alone as completion.
- Keep full Macro acceptance and installed-backend wiring separate from the bounded native capture-finalizer proof.

## Checks

- Run all preparation, strict TypeScript and native tests from the README with the exact compat-web artifact.
- Run ordinary external declaration emission and scoped `just check` before committing.
- Run with `nice 19`; builds use `cargo -j2`, an owned target and the configured private TMPDIR.

## Gotchas

The state fixture closes raw node construction. The capture fixture adopts opaque
JS identities through actual NodeHandles and CapturedRecords; it emulates no node
model methods. Neither fixture is a full ShimBackend or a usable initializer. Native invalid-input cases must
leave the retirement epoch unchanged; successful empty metadata fences advance it.
