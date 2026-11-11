# Exact capture payloads and JS instance handles

`CapturedRecords` indexes actual generated native records. Capture IDs retain
their exact immutable authority; repeated capture IDs cannot change editor,
version, key, instance or access scope. A JS handle instead identifies one native
instance owner/class/instance tuple. New captures of that same instance reuse the
handle and refresh its acknowledged payload. A real semantic COW instance gets a
different handle. Unhydrated records have no invented instance ID.

Metadata-only hydration calls `bind(existingHandle, nativeBindingReply)` before
exposing that reply elsewhere. The reply must have a new issued capture ID and
the same published node key/type/version. It binds the already constructed JS
object; it does not call a constructor again or modify the old capture's wire
reference. The caller then accepts the reply array if it needs node-result lookup.

The required `changed` observer buffers ownership changes for the current JS
instance. It must not throw or reenter the store. A live raw-node owner retains
the new capture before releasing its previous capture, so its acknowledged fields
remain available even when that allocation graph is collected. Mirror/history
references retain their own exact capture IDs independently.

Graph retirement calls `release(version, isRetained)` only after the native
release acknowledgement. It visits that version's indexed captures and preserves
every explicitly retained payload. Later capture releases call `prune` on the
changed ID, rather than scanning the document. Empty version and instance indexes
are removed. Native capture leases and native graph collection are separate;
holding these JS records alone cannot keep a native capture alive.

Native field descriptors and projection values are indexed once per capture.
Unknown/duplicate projection properties reject; fields never cross into native
code. Root cached-text data here is only a wire projection: the production field
binder must route the actual Root instance's derived cache through the separate
authorized JS derived-cache producer, preserving raw captured-instance values.

The focused tests use typed protocol records to check the indexes and retention.
They are not a native model, constructor/bind acceptance, real finalizer proof or
permission to enable the production initializer. Actual instance construction,
strong state ownership, cold native lease acknowledgements and the view/runtime
bindings remain required consumers of this store.
