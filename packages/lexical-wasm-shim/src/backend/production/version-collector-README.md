# Observed version collection and native cleanup

`VersionCollector` consumes the existing `NodeHandles` version-token finalizer
through `backend.collectVersion(version, unowned, released)`. It creates no
`FinalizationRegistry`, ownership token, graph or native version. The existing
single finalizer remains authoritative for EditorState/version ownership; the
backend owns the bridge and the actual native calls.

```ts
const collector = new VersionCollector(runtime, bufferEvent);
collector.collect(version, unowned, released);
const complete = collector.drain();
collector.dispose();
```

Every runtime port is required:

- `canCollect(version)` uses actual JS-local issuance, current/pending update,
  active read, publication and graph-lease guards. It must not perform hidden
  native queries. An issued active or graph-leased version is ineligible.
- `flushLeases()` completes actual capture-lease delivery and acknowledgement.
  It must preserve in-flight callback ownership and must throw if delivery is
  not acknowledged. An empty actual lease queue requires no invented native call.
- `releaseVersion(version)` invokes the actual native retirement entry. Its
  successful return is the acknowledgement; a thrown failure is not one.
- `scheduleDrain(body)` queues work at a safe executor boundary. The backend
  explicitly calls `drain` again when guards close; the collector never polls.

Raw wrapper and mirror capture leases are independent of graph leases. A live raw
wrapper must preserve its exact captured record without pinning the allocation
version forever. Native retirement must therefore preserve independently leased
captures. Do not enable this collector against the earlier native implementation
that deleted all captures by allocation version.

Collection requests retain only the callbacks supplied by the sole producer;
those callbacks must not strongly capture the token being finalized. A protected
version stays queued. If `unowned()` becomes false, its old collection request is
canceled with no `released` callback. A replacement token's actual finalization
will request collection again. Requests arriving during a native lease flush are
preserved, and the latest ownership callbacks and guards are rechecked after that
flush before native retirement. Requests reentered during the retirement call are
kept separate from its submitted prefix and require their own liveness check;
they never inherit another request's acknowledgement.

After a successful native retirement the collector removes its request **before**
calling every owner's `released` callback. Those callbacks can drop mirror refs
and enqueue further capture releases. A second lease flush runs afterward. Failed
or protected post-ack cleanup remains a debt: a later drain retries the lease
flush only, without retiring the graph again or repeating `released` callbacks.
Failures before retirement leave the original collection request queued. A native
error with uncertain effects is never converted into a synthetic acknowledgement;
the native entry's idempotent issued-retired-version contract owns retry safety.

`drain(): boolean` returns true only when its observed request queue and post-ack
cleanup debt are empty. It returns false for protected work, reentrant drain or
disposal. A thrown operation is a failed fence even if some earlier retirements
were acknowledged. Disposal cancels queued JS bookkeeping without native calls or
synthetic release callbacks; the session owner disposes actual native resources.

The optional observer only buffers typed lifecycle events. It must not throw or
reenter the collector. Local sequence numbers preserve queue/flush/release order;
`release-ack` is emitted only after actual successful native return. Lease flush
completion concerns the actual lease queue, which can be empty. Actual API and
physical call IDs must come from the instrumented runtime, never be invented from
these local sequence numbers. Observation does not retain an editor or target.

A true drain is **not** evidence that the engine completed GC, every possible
finalizer ran, or the native retained-capture limit passed. The backend/harness
must independently bind known eligible ownership tokens, actual engine GC
completion, observed finalizer enqueue events, completed lease/prune calls and
source-matched native audit snapshots at unchanged active version. The real
`retainedCaptures <= 2 * liveNodes` check follows that barrier. Snapshot version
and retirement epoch come from the generated native response, not this queue.

Current deterministic tests cover protected/canceled work, disposal, observer
constraints and failed pre-ack paths without fabricating successful native
acknowledgements. Positive native retirement, post-ack failure/retry and one
`--expose-gc` smoke test require the coherent native capture-lease implementation
and matching artifact. Until those run and the backend bridge lands, this is a
source-only checkpoint, not a completed GC barrier or production acceptance.
