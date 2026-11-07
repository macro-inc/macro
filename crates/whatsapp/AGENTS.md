# crates/whatsapp

## What it is

WhatsApp linked devices: the `whatsmeow` protocol port with its protobufs and Signal session code, the linked-device domain, its Postgres store, and a fake server plus end-to-end tests.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`whatsapp_e2e`](whatsapp_e2e/AGENTS.md) | End-to-end tests for WhatsApp linked devices. |
| [`whatsapp_fake_server`](whatsapp_fake_server/AGENTS.md) | Test support for WhatsApp linked devices: a fake WhatsApp server that the real whatsmeow port (`crates/whatsapp/whatsmeow`) connects to over a local websocket, and fake … |
| [`whatsapp_linked`](whatsapp_linked/AGENTS.md) | The WhatsApp provider of external chats (`crates/comms/external_chat`): personal WhatsApp accounts linked as devices, owner-bound pairing, the account's chat list and … |
| [`whatsapp_store_pg`](whatsapp_store_pg/AGENTS.md) | Part of WhatsApp linked devices: the Postgres implementation of every `whatsmeow::store` trait for one linked account, with per-account envelope encryption (KMS-wrapped … |
| [`whatsmeow`](whatsmeow/AGENTS.md) | A faithful 1:1 Rust port of [whatsmeow](https://github.com/tulir/whatsmeow), the Go client for WhatsApp's web multidevice (linked device) API. |
| [`whatsmeow_proto`](whatsmeow_proto/AGENTS.md) | The protobuf types of the `whatsmeow` port (WhatsApp linked-device client): prost code generated at build time from whatsmeow's `proto/` tree, kept in its own crate so … |
| [`whatsmeow_signal`](whatsmeow_signal/AGENTS.md) | The Signal protocol for WhatsApp linked devices: `Libsignal` implements the whatsmeow port's `signal::{CurveSignatures, SignalProtocol}` traits … |

## Recipes

- Add a crate here: create `crates/whatsapp/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
