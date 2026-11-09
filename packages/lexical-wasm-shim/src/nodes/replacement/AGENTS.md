# Registered nodes and replacement

## Scope

Build source-shaped registered-node metadata from the explicit supplied node list.
Reuse full static factory preparation and shared state collection. Collect static
transform identities once per chain and keep configured transform order.
Do not register or authorize an unlisted withKlass class.

`normalize.ts` captures replacement getters once in replace/with/withKlass order
and reuses the actual constructor validator. Keep eager list normalization
separate from the configuration entry's per-row normalization and factory work.

`bindReplacement` captures a class-specific callback and checks the real class
witness before invoking it. BoundNodeReplacement/InternalNodeConfig are internal
invokers. Preserve LexicalNodeReplacement through the upstream type-only reexport;
do not narrow authored callbacks. Normalize public declaration inputs through
actual class-prototype identity and callback-result instanceof checks before
returning internal actual-core types; never return upstream nominal nodes.

`runtime.ts` declares injection only. The actual editor supplies its active scope,
registered map and readonly check; constructor authority stays in the runtime.
Do not bind a fake editor, registry or model for tests. The public $create and
$applyNodeReplacement generic return assertions go through assumeNodeType at
the exact upstream assertion points; list these calls in the contract manifest.
The separate central isInstanceOfKlass guard is a sound runtime witness, not an
additional assertion. Keep its body exactly `return value instanceof klass;`.

## Checks

Run strict package and ordinary declaration checks, replacement/static/state
tests, and scoped just check. Keep pure builder and class-witness tests separate
from real active-registry, replacement construction and native acceptance.
