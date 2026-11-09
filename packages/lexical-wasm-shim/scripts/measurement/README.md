# Compatibility boundary counters

These modules record raw observations in an explicitly instrumented build of the
real generated session glue. They do not activate the editor switch or install a
model. The production Macro route, installed plugin profile and post-GC native
ledger remain required before the full gate can accept evidence.

Run from `packages/lexical-wasm-shim`, using its frozen TypeScript 6.0.3 and
Vitest 4.1.5 dependencies:

```sh
MEASUREMENT_ARTIFACT_ROOT=/absolute/source-matched/wasm-directory \
MEASUREMENT_WASM_DIS=/absolute/path/to/wasm-dis \
TMPDIR=/home/wolf/tmp node node_modules/vitest/vitest.mjs run \
  --config tests/measurement/vitest.config.mts
node node_modules/typescript/bin/tsc -p tests/measurement/tsconfig.json
node node_modules/typescript/bin/tsc -p tests/measurement/tsconfig.json \
  --noEmit false --declaration --emitDeclarationOnly --outDir /absolute/external/declarations
```

The actual-glue case imports the same serialized document through original and
instrumented production sessions, compares real output bytes, text and errors,
and verifies alias-based allocation and raw traffic. It is a boundary equivalence
test, not a full Macro-plugin or native compatibility pass. It writes immutable
input/output hashes and raw observations under `TMPDIR`.

To prepare diagnostic glue without changing shipping files:

```sh
bun scripts/measurement/prepare.ts GLUE WASM WASM_DIS OUTPUT
```

The sidecar binds original glue, transformed glue and WASM hashes to all actual
import/export signatures. Binaryen's disassembly is checked against the compiled
module inventory. Unknown ABI types, payload helpers or transfer patterns fail.
The disabled transform returns the exact original bytes without an audit import.
Ordinary builds do not run this transform. The runtime import is explicit; it
does not create a global product handle or editor.

Bind `AuditRecorder` before initializing diagnostic glue with
`bindAuditRecorder(recorder, request => CompatBatchRequest.decode(request).finalize)`.
Use the actual generated decoder. `measureWindow` preserves synchronous callback
results and opaque throws. Use explicit open/close windows from
`currentAuditRecorder()` when the real update lifecycle spans a deferred commit.
Unbound instrumentation throws rather than silently reporting zero.

`AuditTrace.schemaVersion` is 1. `calls` have globally unique IDs, parent invocation
IDs, ancestor window IDs, API/physical layer, direction, method, category, phase
and completion. API records contain no bytes. `bytes` records have a source tag
(`physical-scalar` or `physical-payload-transfer`), kind, direction, size, phase,
ancestor windows and enclosing invocation ID. That parent may be an API call when
a memory transfer happens between physical entries; it does not charge API bytes.
`references` records separately retain raw slot counts and direction. The eight
bytes per slot are an **accounting charge, not ABI width**. Call/window entry and
exit sequences, transfer sequences and phase events form one complete event
ledger. `validateTrace` replays it before the numeric gate, rejecting duplicate or
missing events, bad links, incorrect phase/window attribution, unsafe counts and
inconsistent source tags. `issues` preserves a failed batch classification while
the actual native operation still supplies its original return or error; such a
trace cannot pass.
Reference source `physical-reference` means lowered ABI parameters/results;
`physical-reference-table` means each actual exported-table get/set transfer.
Both contribute slots and the accounting charge. Table transfers add no function
entry and do not duplicate the already-counted index-buffer bytes.

Physical wrappers are installed once for every real function export, so passing
`wasm.__wbindgen_malloc` as a function value still crosses an observed wrapper.
Every imported function is wrapped before instantiation. They preserve arguments,
receiver, return identity and throws. Scalars use the exact lowered module
signature: i32/f32 4 bytes, i64/f64 8, v128 16; externref/funcref are separate slots.
Payloads count active lengths at actual transfer helpers, not allocator capacity.
Typed shared-memory out-parameter writes are counted as physical buffer transfers
as well; they are not implied by a void function's return signature.
New direct memory accesses and unknown memory-helper contexts fail the transform.

All generated session API methods and exported bridge functions are observed,
including input, takeOutput, wakeAt and finalizer frees. Only synchronous end-update
flush and admission are fixed. Begin, COW, reservation and other legacy calls stay
visible operations. `compatFlush` is a flush and `compatCommit` is admission.
Final `compatBatch` (finalize=true) is admission. Nonfinal batches require
`withBatchPurpose('flush' | 'operation', body)` at the actual call site: the same
request shape can mean a semantic barrier or end-update flush. The hint is consumed
once, so nested callback work cannot inherit it. Missing/inconsistent hints or
decoder failure record an issue, preserve native behavior, and prevent acceptance.
Callback-scope batches are operations. The logical JS host dispatcher
must have exactly one separately guarded API hook; its physical import is already
observed by the transform. Do not duplicate generated API hooks in the backend.

The controller opens the root key/read window; lifecycle hooks use `hasOpenWindow`
before adding update/read windows, keeping unrelated setup and GC raw entries
outside hot budgets. Close each synchronous update window after its flush. After
the actual admission receipt, record `linkCommit(commitId, version, updateIds,
admissionCallId)` once, with exact native identities. Shared microtask admission
can link several contributing updates. Abort/discard drops pending associations.
`commitLinks` retain decimal native identities, update IDs, admission ID and the
last completed event sequence. Replay rejects early/duplicate/missing measured
admission links; it does not invent links from scheduling or version ordering.
Every completed measured update must be a contributing window or carry an explicit
`finishWithoutAdmission` proof: actual compatFinishNoop=true; successful batch
noop=true/published=false; acknowledged discard owning that pending window; or an
empty scope with zero API, physical, payload and reference work. A changed=false
commit is still admission. Contributors must close before admission enters;
later updates cannot be attached retroactively. Generic session-equivalence probes
use explicit diagnostic windows, not measured update/key windows.

`windowMetrics` recomputes API calls, physical entries, four directional byte
components, reference slots and `bytes = numericAbiBytes + bufferPayloadBytes +
8 * refSlots`. Returns reverse byte flow and add no new entry. Ancestor windows
count an entry once each. Failed or unfinished scopes cannot produce a valid pass.
`evaluateCounters` checks every update/read/key observation and every paired key:
fixed API/update <=2 (at most one synchronous flush), API/read=0, API/key<=10,
physical/key<=4*API, bytes/key<=4096,
reference slots/key<=16; physical/bytes/slots at 10000 nodes each <=1.10 times the
same operation at 10 nodes. Native captures must be <=2x live nodes after the
actual GC barrier. Zero baselines require zero targets. No averages hide failures.

The numeric gate does not prove the supplied GC or route claims. Full CI must bind
the actual MarkdownDocument→MarkdownEditor route, installed plugin identity/order/
options/source manifest, exact normalized 10/10000-node fixtures, identical operation
and output hashes, coherent JS/WASM/generated-schema source hashes, and native
snapshot version/retirement epoch plus finalizer/release/prune barrier evidence.
Snapshot allocation/traffic stays visible outside hot windows. The real route
factory and JS barrier are not yet available at this checkpoint; no accepting
producer is registered and no full-plugin test result is claimed.
