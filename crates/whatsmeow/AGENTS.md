# whatsmeow

## What it is

A faithful 1:1 Rust port of [whatsmeow](https://github.com/tulir/whatsmeow), the
Go client for WhatsApp's web multidevice (linked device) API. Ported from
revision `b2b1e71d45e2ff171153b025b5a42f475bb30ef8`.

## Start here

- `src/lib.rs`: module map; one module per Go package, one file per Go file.
- `src/client.rs`: the `Client` (Go's `client.go`); every other top-level
  file adds an `impl Client` block for its Go file. Its header lists the
  deliberate deviations (config struct, `Dialer`, async event handlers).
- Phone-number pairing: `pair_phone` after the first QR event; passkey
  pairing: `Event::PairPasskeyRequest` → `send_passkey_response`,
  `Event::PairPasskeyConfirmation` → `send_passkey_confirmation` (the QR
  channel surfaces both and confirms by itself when the handoff UX can be
  skipped).
- `src/testing.rs`: the fake WhatsApp server and fake Signal used by the
  client tests (also exported behind the `testing` feature).
- `src/signal.rs`: the libsignal boundary (see below) — read before porting
  anything that encrypts, decrypts or signs.
- `src/appstate.rs`: the `appstate` package. `Processor::new(&Device)` clones
  the device's `app_state_keys` and `app_state` handles; the client port
  (`appstate.go`) calls `decode_patches`, `encode_patch`,
  `get_missing_key_ids`, `process_recovery`, `parse_patch_list` and
  `parse_recovery`, and checks `DecodeError::sentinel()` where Go uses
  `errors.Is(err, ErrKeyNotFound)`.
- `src/appstate/client.rs`: the top-level `appstate.go` (the exception to
  `src/<file>.rs`, since `src/appstate.rs` is the package): fetching,
  applying and sending patches, `server_sync` notifications and
  `handle_app_state_sync_key_share` (from `message.go`). Key requests go
  through `Client::send_peer_message`, which encrypts and sends to the
  account’s other devices.

## Public API (what services use)

```rust
let client = Client::new(device, signal /* Arc<dyn Signal> */, ClientConfig::default());
let mut events = client.subscribe(); // or add_event_handler(Arc<dyn EventHandler>)
let qr = client.get_qr_channel(cancel).await?; // before connect, unpaired devices only
client.connect().await?;
client.send_message(&group_jid, message, SendRequestExtra::default()).await?;
client.get_joined_groups().await?; client.get_group_info(&group_jid).await?;
client.download(&*image_message).await?; client.upload(&bytes, MediaType::Image).await?;
client.mark_read(&ids, now, &chat, &sender, None).await?;
client.disconnect().await; client.shutdown().await;
```

- `device`: a `store::Device` whose store handles are your persistence
  (`MemoryStore` in tests). The client owns it as `client.store`
  (`tokio::sync::RwLock<Device>`); pairing and logins write it back with
  `Device::save`.
- `Signal` is `SignalProtocol + CurveSignatures` (blanket impl): pass one
  `Arc` of the libsignal implementation.
- Events (`types::events::Event`): `Qr`, `PairSuccess`, `PairError`,
  `Connected`, `Disconnected`, `LoggedOut`, `StreamReplaced`, `Message`,
  `UndecryptableMessage`, `Receipt`, `GroupInfo`, `JoinedGroup`,
  `HistorySync`, `PushName`, … With `ClientConfig::synchronous_ack`, an
  `EventHandler` returning `false` leaves the node unacked so the server
  redelivers it.
- `SendRequestExtra::no_disconnect_retry` (not in whatsmeow; #8304 patched
  it in) makes a send fail with `ClientError::Disconnected` instead of
  resending after a reconnect, so an unacked send can be recorded as unknown.
- Deviation from Go: the handler queue loop handles a `stream:error` it
  dequeued after the connection ended (Go drops it), so the post-pairing
  515 that arrives with the socket close still triggers the login.
- `ClientConfig::media_base_url` (not in whatsmeow) sends media uploads,
  downloads and deletes to one `scheme://host[:port]` instead of the media
  connection's hosts, for a local fake media server in tests.
- `ClientConfig::dialer` opens the websocket; `testing::FakeServer` (feature
  `testing`) provides an in-memory one and `testing::FakeSignal` a fake
  Signal implementation for service tests.

## What is ported

Client core (`client`, `request`, `connectionevents`, `keepalive`, `qrchan`,
`pair`, `prekeys`, `notification`, `tctoken`, `cstoken`), receiving
(`message`, `receipt`, `retry`, history sync download), sending (`send`:
1:1, groups with sender keys, peer messages, revoke/reaction/edit
builders), `user`, `group`, `presence`, app state (`appstate` package and
its client in `appstate/client.rs`), media (`mediaconn`, `download`,
`download_to_file`, `upload`, `mediaretry`), pairing by QR, phone number
code (`pair_code`) and passkey (`pair_passkey`), `privacysettings`,
`msgsecret` (encrypted reactions, comments, poll votes, secret edits).

Not ported (skipped features): newsletters, calls, status/broadcast lists,
business profiles and links, communities admin, bots and Meta AI (`msmsg`,
WASA), Messenger/Instagram (`sendfb.go`, Armadillo `v=3`, FB device lists),
WASA/bot parts of `msgsecret.go`, reporting tokens, `armadillomessage.go`, `push.go`,
`update.go`, `store/sqlstore` (the Postgres store lives in
`crates/whatsapp_store_pg`).

## Porting rules

- Mirror the Go layout: Go package `x/y` → module `x::y` (`src/x/y.rs`
  re-exporting its files), `x/y/file.go` → `src/x/y/file.rs`, Go `FuncName` →
  `func_name`. A package whose only file shares its name collapses into
  `src/x/y.rs` (`binary/token`). Top-level Go files (`handshake.go`) map to
  `src/<file>.rs`.
- Every ported file starts with the MPL-2.0 header and a line naming the Go
  file it ports: `// Ported from whatsmeow <path> (MPL-2.0, Copyright (c) Tulir Asokan)`.
  Files that aren't ports (`signal.rs`, `store/memorystore.rs`) say so.
- Keep Go's logic, including its string splitting; repo rules such as CS-58
  (nom) don't override a line-by-line port. Where Go panics, silently
  truncates, or uses a sentinel/`Found` flag, return an error or `Option`
  and say so in the doc comment.
- Go callbacks and channels become event receivers (`socket::FrameEvent`,
  `socket::NoiseEvent`); `context.Context` parameters are dropped.
- Protobuf types come from `crates/whatsmeow_proto`, re-exported as `proto`.
- whatsmeow has almost no Go tests. Tests here use expected values produced by
  running whatsmeow's Go code at the pinned revision, so the port is checked
  byte for byte. The generators live in `testdata/generator/` (see its
  README): `inpackage/generate.sh` copies its `*_test.go` files into a
  whatsmeow checkout (they are `package whatsmeow`, so they reach unexported
  code) and writes `testdata/*.json`, read by `src/vectors.rs`; the `media`
  and `appstate` programs reach unexported code with `go:linkname` and write
  `testdata/<area>/vectors.json`.
- The media functions are free functions taking what the client supplies
  (`download::download(&MediaHttpClient, &MediaConn, msg)`); `Client` wraps
  them.
- Client behaviour (pairing, login, IQs, reconnects) is tested against the
  fake server in `src/testing.rs` over in-memory websockets, with
  `#[tokio::test(start_paused = true)]` so timeouts run instantly.
- Nodes the client sends are checked against Go's: the generator's
  `captureNode` records what a Go client method sends (its send log fires
  right before a zero `NoiseSocket` panics), and `client::test::capture_request`
  gets the Rust side; both replace the iq `id` and usync `sid`.
- Go formats JIDs (and sometimes node XML) into error messages; ported errors
  leave them out, since `#[tracing::instrument(err)]` logs them.
- Methods that spawn work which can reconnect return `BoxFuture` (see
  `Client::auto_reconnect`): without it, `Send` inference cycles through
  `connect`.
- Log opaque values only (tags, IDs, counts); unlike Go, never log node XML,
  JIDs or phone numbers.

## Signal protocol boundary

Every Signal call goes through the traits in `src/signal.rs`:

- `CurveSignatures`: XEdDSA signing and verification for prekeys, pairing,
  and the server's Noise certificate.
- `SignalProtocol`: pairwise sessions and group sender keys.
- `SignalProtocolStore`: opaque protocol records, implemented by
  `store::DeviceSignalStore`.

`crates/whatsmeow_signal` implements these traits with Signal's official
AGPL-3.0-only libsignal core and vendored X3DH protocol modules. The repository
is AGPL-3.0; retain MPL-2.0 headers on the whatsmeow port and Signal's SPDX
headers and NOTICE on its protocol implementation. Client unit tests use fakes;
Signal interop and linked-device end-to-end tests exercise the implementation.

## Checks

- `cargo test -p whatsmeow -p whatsmeow_proto`
- After changing a generator: `go run -ldflags=-checklinkname=0 ./appstate`
  in `testdata/generator`, then the tests.

## Gotchas

- License is MPL-2.0 (`LICENSE`), file-level copyleft: keep ported code in
  these crates, don't copy it into Macro crates.
- Never connect to real WhatsApp servers or link a real account from tests;
  socket tests run over in-memory websockets (`tokio::io::duplex`).
- `FrameSocket::connect` dials `wss://` with rustls; the binary must install a
  rustls crypto provider first.
- Media functions take `download::MediaHttpClient`; its crate-private
  `scheme` and `host_override` (set by `with_base_url`) let tests talk plain
  HTTP to local fake hosts (Go hardcodes `https`). Tests never contact WhatsApp media hosts.
- Regenerating `testdata/media/vectors.json` changes it every run: Go's
  `Upload` picks a random media key, which the vectors record.
- Node hex in the `inpackage` vectors changes every run (Go map order of
  attributes), so tests compare unmarshaled nodes; revert files whose only
  change is that churn.
- tungstenite has no permessage-deflate, so connections are uncompressed
  (Go negotiates compression).
- `store::clientpayload` keeps the WA version and OS info in process-wide
  locks, as Go keeps package variables; tests use the private builders instead
  of the setters so they don't race.

- Async closures that borrow their captures don't produce `Send` futures,
  so a Go callback awaited inside an async fn becomes an enum or trait
  (`appstate::PreviousValueMacs`); `appstate/keys/test.rs` asserts the
  `Processor` futures are `Send`.
- Go's appstate encodes with random IVs, so encoded patches are tested by
  decoding them with MAC checks, not byte comparison.
- Go marshals node attributes in random map order: compare Go-generated
  nodes decoded (`Vectors::node`), not as bytes. In-package generators
  capture a request by logging it through `sendLog` and sending with a
  cancelled context (`appstate_client_vectors_test.go`).
- Go's `EncodePatch` doesn't set the patch version (the server does) and
  doesn't look inside its own patch for an earlier SET of the same index, so
  a test patch must not set one index twice (`BuildArchive` also unpins).

## Related

- `crates/whatsmeow_proto/AGENTS.md`
