# Static node configuration

## Scope

Prepare real getType, clone, importJSON and importDOM factories before collecting
shared NodeState configuration. Keep actual LexicalNode constructor/self types.
Walk concrete classes before their ancestors; inherited configs overwrite shared
keys while flat flags accumulate, matching the pinned upstream algorithm.

The pending clone source is a single consume-once token. Default clone writes it
then invokes the actual constructor; do not add cleanup absent upstream.
Preserve constructor checks and installed-factory order, including the exact
pinned required-argument diagnostic. Original compiled invariant arguments are
lazy: do not introduce extra length getter reads on successful checks.
Runtime construction owns token validation, clone authorization and rollback.
This module does not authorize a clone or replace constructor staging.

## Checks

Run strict package checking, ordinary declaration emission, focused static-config
and state tests, and scoped just check. Keep factory preparation proof separate
from successful hosted custom construction, clone, state and rollback acceptance.
