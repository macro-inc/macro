# Capture ownership and acknowledged lease drains

`CaptureLeases` tracks independent JS owners of actual native-issued captures for
one editor. It contains no model, version allocator, executor or native call.
Only the production backend can prove issuance/liveness; it must supply authentic
`IForeignRecordRef` values. Zero/out-of-range capture IDs, foreign editors and
conflicting authority fields for an owned/in-flight capture ID are rejected.
Binding a new instance identity must issue a new capture ID, never change an old
reference's authority.

```ts
const leases = new CaptureLeases(editorId);
leases.retain(record);
leases.release(record);
const drain = leases.beginDrain();
// drain?.leases is the generated ICompatCaptureLeases payload.
```

`hasOwners(captureId)` is an O(1) local-owner query. It ignores acknowledged
native holds and in-flight requests; it does not report graph/version ownership.

Each raw wrapper and each mirror-owned exact reference independently retains and
releases its ownership. Duplicate decoded refs with identical authority share the
capture ID count. The helper checks the complete node tuple, version, update ID
and access before accepting another owner or release. It never normalizes fields
or equates captures just because their node keys match. Once an entry is fully
unowned and unheld it is forgotten; preventing use of a retired native ID remains
the backend's issuance/liveness responsibility.

`beginDrain` returns `undefined` for no work. Otherwise it returns one frozen
object containing a frozen generated payload and frozen retain/release arrays.
Do not mutate a drain or manufacture its identity. Only one drain may be in
flight. The backend can piggyback the payload on an actual batch or send it through
the actual cold `compatCaptureLeases` export. It must apply **every retain before
any release**, then settle exactly that drain:

- `acknowledge(drain)` records actual native lease application. A typed operation
  failure after lease admission still requires this acknowledgement.
- `rollback(drain)` records that lease application definitely did not occur, such
  as a rejected envelope before consumption. It preserves the native-held state
  and recomputes pending work from current local ownership.

Do not infer acknowledgement from `changed`, a new version, a successful JS
callback or the absence of an exception. A transport error with unknown admission
is not proof for rollback: leave the drain unresolved until the native outcome is
known. Receipt decoding/publication must not release emission pins or graphs
before newly decoded local owners have acquired their leases. The helper adds no
fake update/version to obtain a receipt.

Native-held bits change only on acknowledgement, and an in-flight snapshot keeps
its entries alive until settlement. Host callbacks can acquire/release any capture
while a batch runs. Settlement reconciles against those *current* owner counts;
it never clears them or assumes they still equal the sent snapshot. An in-flight
retain followed by local release therefore queues a later release after success,
but vanishes after rejection. Reacquisition during a release queues a later retain
after success and needs no work after rejection. Unsent opposite changes cancel.
New callback-owned captures outside the sent snapshot remain pending throughout.

Capture IDs with changed ownership are indexed directly. Draining and settling
visit only pending/sent IDs, not every live wrapper/node/document. Pure reads of
model state do not require a drain. Graph/version GC does not decrement local
wrapper or mirror ownership; their actual owner release notifications do that.

The focused tests exercise this queue, generated payload encoding and host-callback
interleavings, including 10,000 owners. They do not prove native issuance, actual
cold/batch receipt behavior, finalizer fences, full Macro plugins or capture
retirement. Production backend/handles integration and native acceptance remain
separate requirements. This source slice does not modify those owners' files.
