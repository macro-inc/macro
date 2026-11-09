# Built-in compatibility nodes

## Scope

Port the public and DOM methods of the pinned Lexical v0.45.0 built-in classes.
Keep construction, cloning, bindings and model context in `runtime.ts`.

`base.ts`, `element.ts`, `text.ts`, `tab.ts` and `builtins.ts` implement the
classes; `index.ts` exports them and hydrates built-ins. Import superclass values
from their defining module so class evaluation does not depend on barrel order.
`dom-import.ts` and `text-dom.ts` implement the node DOM methods.
`config.ts` and `dom-types.ts` carry the actual core's recursive types.
`editor-config.ts` carries the full public render configuration with actual core
node and editor types. Public node methods use it rather than the view's minimal
internal configuration; resolve configured DOM hooks through the actual editor.
Preserve the upstream public config-record alias and its constraints; the
central exception's internal return shape uses the actual core config types.
`runtime-primitives.ts` resolves nodes, writable captures and native-backed field
writes through `runtime.ts`. `../compatibility-exceptions.ts` centralizes the
three approved upstream assertions; keep their call sites in the type-contract
manifest. The production backend must supply acknowledged local reads and batched
writes; the legacy conformance backend still makes diagnostic native calls.

## Boundaries

- Read captured own fields through `nodeField`; resolve current values through the active graph before reading.
- Serve public graph and scalar reads from the local mirror without WASM calls.
- Keep base dirty checks on acknowledged leaves and Element overrides on acknowledged elements; Root reads its captured cache and falls back to active traversal according to the actual read scope and dirty type.
- Reject missing root-cache and dirty metadata capabilities rather than substituting empty sets or cached text.
- Send writes through the runtime buffer and preserve upstream native-super dispatch.
- Reuse `lexical-wasm-view/compat` DOM slots and the actual core classes in method signatures.
- Preserve upstream generic constraints and self returns; use the centralized runtime adapter only for upstream caller-asserted generic APIs.
- Preserve upstream field reads and getter evaluation counts; formatting flags read latest raw fields and Element JSON samples each text-format/style getter once.
- Refresh both paragraph legacy JSON text fields together when either Element JSON field is absent.
- Route TextNode spellcheck and HTML export format decisions through its public hasFormat predicate while keeping tag structure on captured format bits.
- Keep upstream MIT notices on ported implementation code.

## Checks

Run the package's strict TypeScript check and real WASM tests, the pinned node oracle,
and node identity and crossing-count regressions. Report source-model oracle runs
separately from actual native acceptance.
Keep base TextNode slot proofs separate from mounted Element/TaskList acceptance;
Element slots require the real active view editor and block-cursor binding.

Run `tests/run-oracle.ts` with `LEXICAL_NODES_UPSTREAM_ROOT` pointing to the
unaltered v0.45.0 source and `LEXICAL_NODES_NATIVE_CONFIG` pointing to the native
facade unit-test configuration. The runner checks original suite hashes before
and after execution and requires all 275 assertions to pass without skips or
incomplete results. Keep the report candidate-only with `nativeAcceptance:false`
until external engine identity proof is bound.
