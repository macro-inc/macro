# Actual-node caret source

Port the pinned v0.45.0 caret algorithms over actual core node classes. Keep
public generic direction and origin relationships exact; do not substitute the
view's internal traversal subset or upstream node classes.

Ordering uses the centralized compareNumberWithUpstreamType adapter. Upstream
accepts NaN text offsets and returns NaN despite declaring -1 | 0 | 1. Preserve
that result without finite checks, clamping or a second assertion. The pinned
core source contains one Math.sign site, in LexicalCaret.ts:1207; the comparison
call site is ancestry.ts $comparePointCaretNext. The remainder of the caret
producer is being ported; no root forwarding or native acceptance is implied.

## Checks

Run source.config.mts tests, strict package types/hooks, ordinary declaration
emission and scoped just check. Source adapter tests do not exercise native
construction or count toward the 2,766-assertion real-engine oracle.
