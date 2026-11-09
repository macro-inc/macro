# Caret algorithms over actual nodes

`types.ts`, `node-carets.ts`, `ranges.ts` and `ancestry.ts` port the full pinned
v0.45.0 LexicalCaret source. `utils.ts` ports selection conversion, traversal,
normalization, text removal and text splitting from LexicalCaretUtils.
`direction.ts` contains the two direction conversion helpers. Runtime values and
public self references use actual core nodes and selections, never Original nodes
or the view's minimal internal graph.

The internal literal direction map has an explicit readonly indexed type. Its
indexed `FlipDirection<D>` preserves the original generic class relationships.
The conditional caret and range direction helpers expose the exact pinned public
overloads; their checked union implementations use the original identity branch
and `getFlipped()` operations. No assertion, generic constraint narrowing or
manufactured result is used. Strict TS6 controls verify generic directions,
subtype origins, conditional node/text results and negative assignments.

The only numeric ordering assertion remains the centralized adapter documented
in comparison.md. Source classes and ranges add no assertions. The source is
split without changing evaluation order within constructor maps; a cold import
does not construct a node or require an engine.

`$splitAtPointCaretNext` is absent until the real `$copyNode` constructor/clone
authority producer exists. Its exact options interface is available. There is no
replacement default callback or native whole-operation fallback. Selection
conversion uses existing actual helpers; their real scoped runtime binding is
still required before activation.

Development-WASM controls use actual editor graphs alongside independent Original
graphs. They cover iteration, slices, common-ancestor ordering, NaN, normalization,
lookup, direction identity, text removal and live-node reordering. They are
source controls, not production/native-oracle acceptance. Root exports and runtime
installation are owned separately.

Invalid text offsets preserve the pinned development throw and production warning
before clamping. Run `NODE_ENV=production bun src/caret/tests/production-offset.ts`
from the package to exercise the warning against Original with real editors.
