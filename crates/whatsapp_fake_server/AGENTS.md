# whatsapp_fake_server

## What it is

Test support for WhatsApp linked devices: a fake WhatsApp server that the real
whatsmeow port (`crates/whatsmeow`) connects to over a local websocket, and fake
phones (the other people) with real Signal sessions from `whatsmeow_signal`.
Lets the session service and its tests run end to end without WhatsApp.

## How it works

- `FakeWhatsApp::start()` binds a websocket port (noise XX responder, binary XML)
  and a plain-HTTP media port on `127.0.0.1`.
- The server's noise certificate chain is signed by a test root key, not
  WhatsApp's. Clients must use `test_signal()` (`TestSignal`): libsignal with
  WhatsApp's root key swapped for the test root when verifying. Nothing else is
  faked; prekey, pairing and message crypto are real.
- `add_user` creates a user with a phone (device 0, a `FakePhone` in process)
  that publishes prekeys. `FakePhone::scan_qr` approves a client's QR code; the
  client signs, gets the 515 restart and logs in as device 1, 2, ….
- Routing is LID-first like WhatsApp today: groups use `addressing_mode="lid"`,
  usync returns LIDs, delivered stanzas carry `participant_pn` / `sender_pn`.
- A message handed to a connection stays unacked until the device sends a
  receipt or message ack; if the connection drops it goes back to the offline
  queue and is delivered again on the next login, then `<ib><offline/>`.

## Start here

- `src/lib.rs`: the `FakeWhatsApp` API (users, groups, kick, drop connection,
  delivery counters, waiters).
- `src/group_change.rs`: `change_group` adds, removes (a user removing
  themselves left), renames, describes, promotes and demotes, turns
  disappearing messages on or off, and sends the
  `w:gp2` notification (one id and `t` for every device) naming who did it as
  `participant` / `participant_pn`; `rename_group` / `remove_from_group` name
  no one, as changes WhatsApp makes.
- `FakeWhatsApp::create_community` makes a community and its announcement
  group (admins-only); `create_community_group` adds a group to it.
- `src/state.rs`: routing, IQ handlers (encrypt, usync, w:g2, w:m), offline queues.
- `src/phone.rs`: fake phones: send/receive with real Signal, QR approval.
  Phones remember chat messages and answer their linked devices' peer
  requests: on-demand history pages and placeholder resends
  (`answer_history_requests(false)` is an offline phone).
  `send_history_sync` / `chat_list()` send history-sync bundles inline.
  `FakeWhatsApp::address_by_lid_only` drops `participant_pn` in a group.
- `src/phone/content.rs`: `upload_media` (any attachment kind; build the
  sticker, GIF, voice note or view-once message around the response and
  `send_message` it) and `vote` (a poll vote encrypted with the poll's
  message secret for the voter's LID; take the secret from the poll's
  `message_context_info`, e.g. `whatsmeow::msgsecret::build_poll_creation`).
- `src/connection.rs`: handshake, login, `conflict replaced`, pairing.

## Checks

- `cargo test -p whatsapp_fake_server`

## Gotchas

- Never point it at real WhatsApp; it only listens on `127.0.0.1`.
- Waiting is event driven (`Shared::wait_for` re-checks on every state change);
  don't add sleep loops.
- Media: clients set `ClientConfig::media_base_url` to `media_base_url()`
  (plain HTTP); phones upload and download with whatsmeow's own media crypto.
- Unhandled IQs get an empty `result`; add a handler in `State::handle_iq` when
  the port starts parsing a response.
- whatsmeow drops a `w:gp2` notification whose change element lacks a
  required attribute (a `<subject>` needs `s_t`), with only an error log.

## Related

- `crates/whatsmeow/AGENTS.md`, `crates/whatsmeow_signal/AGENTS.md`,
  `crates/whatsapp_e2e/AGENTS.md`
