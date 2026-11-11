# Actual-node caret source

Port the pinned v0.45.0 caret algorithms over actual core node classes. Keep
public generic direction and origin relationships exact; do not substitute the
view's internal traversal subset or upstream node classes.

Ordering uses the centralized compareNumberWithUpstreamType adapter. Upstream
accepts NaN text offsets and returns NaN despite declaring -1 | 0 | 1. Preserve
that result without finite checks, clamping or a second assertion. The pinned
core source contains one Math.sign site, in LexicalCaret.ts:1207; the comparison
call site is ancestry.ts $comparePointCaretNext. Keep source classes, factories,
ranges and utilities split below 1000 lines. Direction helpers preserve pinned
conditional public overloads and the exact runtime branches; the implementation
checks the complete actual caret union without an assertion.

The final split-at-point utility remains blocked on the real authorized $copyNode
producer. Do not insert an engine call, Original runtime alias or fake clone
binding. Selection helpers retain their existing actual scoped runtime; this
module does not fabricate one. Root forwarding belongs to the surface owner.

## Checks

Run source.config.mts adapter tests, focused caret.test.ts through the normal
real-conformance setup, strict package types/hooks, ordinary declaration emission
and scoped just check. Run `NODE_ENV=production bun src/caret/tests/production-offset.ts`
from the package for the real-editor production warning regression.
contract.type-test.ts checks generic directions and actual
subtype origins. These diagnostic controls do not count toward the 2,766-assertion
production oracle.
