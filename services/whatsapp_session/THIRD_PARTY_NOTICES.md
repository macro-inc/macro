# Third-party source and release review

The Go module and `go.sum` pin the build. `go.sh` applies the checked-in patch to a
private copy of whatsmeow; an unpatched build fails its safety-version reference.

| Component | Exact source | License/evidence |
| --- | --- | --- |
| whatsmeow | `b2b1e71d45e2ff171153b025b5a42f475bb30ef8`, pseudo-version `v0.0.0-20261017175727-b2b1e71d45e2` | MPL-2.0; copied LICENSE in `licenses/go.mau.fi_whatsmeow@…` |
| libsignal | `go.mau.fi/libsignal v0.2.2` | GPL-3.0; copied full license |
| SQLCipher Go binding | `github.com/mutecomm/go-sqlcipher/v4 v4.4.2` | MIT binding; upstream bundled SQLCipher/SQLite source notices also apply |
| Native authenticator (separate desktop artifact) | `beeper/webauthn-rs@579f9144d37161bedf25ed1236d73486ce303de6` | MPL-2.0 fork; Cargo.lock records the exact transitive graph |
| QR renderer (web artifact) | `qrcode 1.5.4` | MIT; lockfile pins the package |

`licenses/manifest.json` records the resolved cached module graph, checksums and
hashes of copied top-level LICENSE/NOTICE files, including dependency/test modules.
It is an inventory, not an assertion that all licenses are interchangeable or that
it replaces a distribution review of bundled C sources, OS libraries and the final
image. The runtime image includes these notices. Go's standard library/toolchain
and Debian runtime notices retain their own distribution requirements.

`patches/0001-controlled-dispatch.patch` is original minimal modification of MPL
files at the pinned commit: per-request suppression of disconnect resend, a
context-aware websocket write, and synchronous retirement of an interrupted Noise
writer. `patches/noise_writer_test.go.txt` exercises a real blocked websocket write
and proves the writer has stopped before cancellation returns. `patches/0002-durable-inbound.patch` also fixes protocol-part failure polarity,
aggregates grouped-receipt failures, suppresses premature peer receipts in the
manual-history path, and exposes a bounded parser while retaining upstream private
protocol storage. Its regression tests exercise placeholder recovery, grouped
receipts and decompression limits. No upstream PR was merged wholesale. Track upstream issues #1226/#1284/#1285 when updating the pin.

No mautrix-whatsapp AGPL connector/converter source was copied. Its project and
mautrix-manager's authenticator wrapper were source references. The Node wrapper
was not added to Macro; the desktop uses the Rust library directly.

**Unresolved release approval:** legal/release owners must review the exact
combined Go service artifact (including GPL-3.0 libsignal), the native fork, the
corresponding-source delivery obligations and the intended hosting/distribution
model. Preserve this source, patches, module sums, build recipe and upstream source
availability as part of that decision. Do not enable distribution/deployment on an
assumed MPL-only license or invent an exception. Approval is tracked in the normal
companion PR review; this document does not claim it was obtained. WhatsApp
permission/account safety is a separate question from software licensing.
