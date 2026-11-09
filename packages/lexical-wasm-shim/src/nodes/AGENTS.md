# Built-in compatibility nodes

## Scope

Port the public and DOM methods of the pinned Lexical v0.45.0 built-in classes.
Keep construction, cloning, bindings and model context in `runtime.ts`.

## Boundaries

- Read captured own fields through `nodeField`; resolve current values through the active graph before reading.
- Serve public graph and scalar reads from the local mirror without WASM calls.
- Send writes through the runtime buffer and preserve upstream native-super dispatch.
- Reuse `lexical-wasm-view/compat` DOM slots and the actual core classes in method signatures.
- Preserve upstream generic constraints and self returns; use the centralized runtime adapter only for upstream caller-asserted generic APIs.
- Keep upstream MIT notices on ported implementation code.

## Checks

Run the package's strict TypeScript check and real WASM tests, the pinned node oracle,
and node identity and crossing-count regressions. Report source-model oracle runs
separately from actual native acceptance.
