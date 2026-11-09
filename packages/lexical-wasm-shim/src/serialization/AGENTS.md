# JavaScript JSON serialization

## Scope

Keep actual class importJSON/exportJSON hooks authoritative. Use prepared actual
registrations and node methods; do not route through native whole-document JSON.
Import captures the registry once, validates type, invokes importJSON, then reads
children and recursively appends. Export invokes exportJSON before constructor
validation and child traversal; append to the exact array returned by the hook.
Preserve property/getter and hook order without pre-validating unrelated fields.

JSONRuntime binds the actual active editor, prepared registered map and Root in
editor.ts. Its associated readonly read obtains the real editor from the private
EditorState owner WeakMap; exportJSON hooks run under that owner even inside
another editor's read. Detached parseEditorState remains blocked on native support. Never fabricate
an active scope or bind a fake runtime for tests. Constructors remain subject to
real registry/clone authority; unsupported construction must remain explicit.
See README.md for the design-only detached writable-scope requirements; do not
add speculative receipt objects, binders or guard-only authority APIs.
Public serialized data aliases are upstream type-only exports. Root export uses
the actual Root method's strong type, not an arbitrary generic return assertion.

## Checks

Run strict package types/hooks, ordinary declaration emission, serialization tests
and scoped just check. Keep recursive components over real nodes separate from
public runtime-binding, custom-constructor and native JSON acceptance.
