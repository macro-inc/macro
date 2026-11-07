# Node-map and keystroke benchmark

Run `TMPDIR=/home/wolf/tmp cargo bench -p lexical_model --bench node_map -j4`.
The CSV contains median and p95 microseconds after 50 warmups, with 1000 samples
at 190/3835 nodes and 300 samples at 36530 nodes. Run a release benchmark; debug
builds do not give a useful comparison. Keep previous snapshots alive during the
measured operation so every write exercises persistent-map copy-on-write.

The deterministic core document has root, paragraph blocks and about nine text
leaves per block. Alternating plain/bold formats prevent normalization from
collapsing the fixture. The caret is in a plain text leaf near the document's
middle. Node counts are asserted before and after every sample group. This
matches the node counts of the upstream benchmark documents, not their rich-node
mix or exact bytes. Text grows by one character per keystroke, as upstream does.

- `write_rollback`: transaction creation, one text write, read and rollback.
- `keystroke`: select a UTF-16 position, insert a character, normalize, transform,
  GC, compute mutations, reconcile model caches, publish and release the commit.
- `keystroke_diff`: the complete keystroke plus structural diff creation.

Both headless and view-attached model modes run. View-attached here includes model
cache reconciliation; it does not run a browser renderer. Snapshot release after
the timed operation, document setup and CSV formatting are outside the sample.

Compare with `/home/wolf/tmp/lexical-port/notes-bench.md`, pinned upstream 0.45.0:

| Nodes | Chrome update | Bun update | Node update | Chrome getWritable ×1 |
| --- | --- | --- | --- | --- |
| 190 | 25 µs | 21 µs | 15 µs | 10 µs |
| 3835 | 20 µs | 31 µs | 19 µs | 10 µs |
| 36530 | 25 µs | 73 µs | 52 µs | 25 µs |

Compare native complete keystrokes with the update column conservatively: native
measurements include commit work that upstream times separately. Do not use the
much slower upstream headless totals to establish an update-phase improvement.
Native code and historical JS measurements on a noisy shared machine cannot
establish browser input-to-paint latency; the shipped WASM/browser gate belongs
to the later end-to-end performance work package. Record medians, p95, fixture
shape and runtime alongside every claim; wall-clock tests are not CI assertions.

The optimization proves root-text changes locally only for one retained leaf in
an otherwise identical element tree. Opaque decorators, dynamic element flags,
structural changes and multiple dirty leaves retain the exact full comparison.
These cases are covered by correctness tests but are not measured by this steady
plain-text typing benchmark. Full root-text reads still walk the document lazily.
