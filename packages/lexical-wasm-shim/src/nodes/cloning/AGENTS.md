# Clone field algorithms

## Scope

Keep source-exact Base, Element and Text clone field algorithms here. Runtime
binding must use the actual native clone stage and validate each source/target
pair before writing. Never supply writable stand-ins, invented tokens, a JS node
graph, native JSON or backend nodeCall fallback.
The clone binding's getRawState must check the real active stage before returning
a record: getWritable/reset can change JS-owned state before setRawState runs.
Wrap the underlying direct state accessor with that guard; ordinary StateRuntime
captured reads retain their separate outside-active-scope contract.

Preserve raw getter/write order with individual typed field operations, not eager
patch snapshots. Same-key Base copies parent/next/prev then shares raw state,
including undefined. Different-key Base copies existing state through getWritable
and otherwise leaves constructor state alone. Preserve both source state reads
in guarded copy/reset branches; disappearance indicates a broken producer.
Element tree pointers/size copy only for same keys; its other fields always copy.
Text fields always copy. Never patch key/type or Root-derived cache fields.

Element/Text helpers contain fields only. Public class wrappers retain the real
super.afterCloneFrom dispatch when the owner wires them. resetStateOnCopy uses
StateRecord.getWritable(target).resetOnCopyNode; it never serializes values or
directly resets unknown state. Actual state storage/rollback and constructor
authority belong to the runtime producer.

## Checks

Run strict source types/hooks, ordinary declarations, clone type/cold checks,
existing real-node StateRecord tests, and scoped just check. Native field writes,
same-key clone execution, wrapper dispatch and rollback need real staged runtime
binding; do not fabricate it to make tests pass.
