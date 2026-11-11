# Raw capture owners

`CaptureOwners` is the production raw-wrapper ownership component. Its single
module-instance registry retains only a weak store and a mutable exact-reference
slot. `NodeHandles` holds the returned owner token with the actual JS instance
through its existing ephemeron; the registry never retains that instance.

Required ports retain/release exact issued capture leases, clean record and handle
metadata after a finalizer, and schedule an executor-safe lease drain. Finalizers
only enqueue local releases and cleanup; they never call native code inline.
Ports must not throw or reenter this component. The scheduled drain must guard
pending/disposed native sessions and preserve failed acknowledgement debt.

`own(handle, node, reference)` treats the not-yet-bound JS node as opaque. Live
handle identity cannot be replaced. Duplicate references must preserve every wire
authority field. `CapturedRecords` validates the exact instance before forwarding
`refresh(handle, next)`. Refresh retains the new issued capture before releasing
the previous one. The finalizer slot follows that refresh, so it releases the
latest lease once rather than the original capture again.

Mirror/history references already hold their independent native leases. Their
`retainHandle`/`releaseHandle` counts keep an existing or subsequently created
owner token strongly alive only while a real graph owner exists. Releasing the
last graph count drops that root without pretending that a finalizer ran.
A late finalizer releases only its own slot; it cannot remove a replacement token
or a current graph owner. Allocation-version retirement never substitutes for a
raw capture finalizer.

The source-matched native fixture in `../../../tests/collector-native/README.md`
uses this same component, actual NodeHandles/CapturedRecords and generated native
lease/audit APIs. It observes actual V8 completion, the owner finalizer, scheduled
release acknowledgement and a subsequent native fence separately. This proves
the raw capture lifetime boundary, not full application runtime installation or
the Macro plugin/measurement acceptance profile.
