# go.mau.fi/libsignal oracle

Test tooling for `crates/whatsmeow_signal`; not built in CI.

`main.go` runs [go.mau.fi/libsignal](https://github.com/tulir/libsignal-protocol-go)
v0.2.2, the version whatsmeow `b2b1e71d45e2ff171153b025b5a42f475bb30ef8`
pins, behind a JSON-lines protocol on stdin/stdout: one request per line
(`new_device`, `make_bundle`, `process_bundle`, `encrypt`, `decrypt`,
`create_sender_key`, `process_sender_key`, `delete_sender_key`,
`group_encrypt`, `group_decrypt`, `sign`, `verify`), one response per line.
Bytes are hex. Each device keeps its stores in memory, serialized the way
whatsmeow serializes them, and trusts identities on first use like
whatsmeow's SQL store.

`src/interop_test.rs` drives it through one conversation: XEdDSA signatures
both ways (both sign-bit values), pre-key bundles and pre-key messages in both
directions, with and without a one-time pre-key, several ratchet turns with
out-of-order and duplicate messages, and sender keys in both directions with
rotation. Rust's randomness is seeded, so the conversation is deterministic on
the Rust side; `testdata/interop_transcript.json` records every request and
response, and `cargo test` replays it.

Go is on `PATH`, or `nix shell nixpkgs#go`. From the repository root:

```sh
# Talk to Go live.
cargo test -p whatsmeow_signal talks_to_go_libsignal -- --ignored
# Regenerate the transcript (after changing the conversation or the seeds).
cargo test -p whatsmeow_signal record_go_transcript -- --ignored
```

The replay also fails when Rust's output changes for the same seed, for
example after a `rand` upgrade changes `StdRng`; regenerate the transcript
then, after checking the live test passes.
