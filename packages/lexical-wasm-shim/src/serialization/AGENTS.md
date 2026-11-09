# JavaScript JSON serialization

## Scope

Keep actual class importJSON/exportJSON hooks authoritative. Use prepared actual
registrations and node methods; do not route through native whole-document JSON.
Import captures the registry once, validates type, invokes importJSON, then reads
children and recursively appends. Export invokes exportJSON before constructor
validation and child traversal; append to the exact array returned by the hook.
Preserve property/getter and hook order without pre-validating unrelated fields.

JSONRuntime is typed injection only. The editor owner supplies the actual active
editor, registered map, associated readonly state read and Root. Never fabricate
an active scope or bind a fake runtime for tests. Constructors remain subject to
real registry/clone authority; unsupported construction must remain explicit.
Public serialized data aliases are upstream type-only exports. Root export uses
the actual Root method's strong type, not an arbitrary generic return assertion.

## Checks

Run strict package types/hooks, ordinary declaration emission, serialization tests
and scoped just check. Keep recursive components over real nodes separate from
public runtime-binding, custom-constructor and native JSON acceptance.
