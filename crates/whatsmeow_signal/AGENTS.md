# whatsmeow_signal

## What it is

The Signal protocol for WhatsApp linked devices: `Libsignal` implements the
whatsmeow port's `signal::{CurveSignatures, SignalProtocol}` traits
(`crates/whatsmeow/src/signal.rs`), so it is a `whatsmeow::Signal`;
`libsignal()` returns it as the `Arc<dyn whatsmeow::Signal>` a `Client`
takes. `LibsignalProtocol` and `LibsignalCurveSignatures` are older aliases.
AGPL-3.0-only.

## How it works

- XEdDSA and Curve25519 keys: `libsignal-core`, unmodified, git tag `v0.105.2`
  (the root `Cargo.toml` pins it).
- X3DH, Double Ratchet and sender keys: libsignal's `rust/protocol` modules
  vendored from tag `v0.74.1` into `src/protocol/` and patched (`NOTICE` and
  each file header list the changes). Official libsignal can't be used as a
  dependency for these: since v0.75 it rejects bundles and pre-key messages
  without Kyber (WhatsApp has none); every version writes version-3 messages
  with the byte `0x34`, which whatsmeow's MAC check rejects ("no valid
  sessions" — it recomputes the MAC over `0x33`); and its sender key wire
  format (distribution UUID + chain ID) is not WhatsApp's (32-bit key ID).
- Records cross the store as libsignal's `RecordStructure` and
  `SenderKeyRecordStructure` protobufs (`proto/storage.proto`, field numbers
  unchanged). whatsmeow's Go stores keep JSON records, so a Go whatsmeow
  database can't be imported as is.

## Start here

- `src/lib.rs`: the trait implementations and error mapping.
- `src/interop_test.rs` + `testdata/generator/README.md`: the Go interop rig.
- `tests/client_end_to_end.rs`: the real whatsmeow `Client` on `Libsignal`
  against `whatsapp_fake_server` (a dev-dependency cycle cargo allows; it
  must stay an integration test so both sides share one crate instance).

## Checks

- `cargo test -p whatsmeow_signal` (replays `testdata/interop_transcript.json`)
- After touching `src/protocol/`: also run the live Go test, see
  `testdata/generator/README.md`.

## Gotchas

- Don't upgrade the vendored modules to a newer libsignal tag wholesale: newer
  code assumes Kyber and SPQR. Port fixes by hand and record them in `NOTICE`.
- Never log or put in errors a `SignalAddress`: its name is a phone number
  or LID.
- `LibsignalProtocol::seeded` / `LibsignalCurveSignatures::seeded` exist only
  under `cfg(test)`; production randomness is `StdRng::from_os_rng` per call.
- The transcript replay pins Rust's exact output for its seeds; a `rand`
  upgrade can change `StdRng` and require re-recording.
- Do not take code from whatsapp-rust, wa-agent, libsignal-node or
  go.mau.fi/libsignal (GPL); the Go oracle only calls it.

## Related

- `crates/whatsmeow/AGENTS.md` (the trait boundary)
