# crates/comms

## What it is

Messaging: channels and their messages, labels and bots, AI chat (`chat`), calls, contacts, the connection gateway port, Slack integration and external chats, mention parsing, and their shared store (`comms_db_client`).

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`call`](call/AGENTS.md) | Part of Calls: Macro's video/audio call management (hexagonal), using LiveKit as the RTC backend — call lifecycle, LiveKit rooms, recordings, and in-call chat. |
| [`channel_bots`](channel_bots/AGENTS.md) | Part of Chat and Documents: built-in agents for document comments and channel messages. |
| [`channel_labels`](channel_labels/AGENTS.md) | Part of Chat: shared or private named groups of chat channels shown in the Chat sidebar, following the standard hexagonal crate layout. |
| [`channels`](channels/AGENTS.md) | Part of Chat: paginated channel messages — threads, reactions, attachments, DMs, and the shared message store other domains discuss things on. |
| [`chat`](chat/AGENTS.md) | Part of AI chat: chats and chat messages, persistence, HTTP/toolset adapters, and lifecycle events. |
| [`comms_db_client`](comms_db_client/AGENTS.md) | Part of Chat's shared infrastructure: the query layer for channel messages, participants, mentions, and activity — the shared tables behind channel/document … |
| [`connection`](connection/AGENTS.md) | Part of shared infrastructure: a domain port over the connection gateway, sending realtime invalidation events and arbitrary channel messages to users, independent of … |
| [`contacts`](contacts/AGENTS.md) | A facade that re-exports the split contacts crates under their old module paths (`contacts::domain` = `contacts_core`, `contacts::inbound` = `contacts_inbound` … |
| [`contacts_core`](contacts_core/AGENTS.md) | Part of Contacts: the contact graph, meaning who each user knows, built from message and call activity and explicit relationships. |
| [`contacts_inbound`](contacts_inbound/AGENTS.md) | Part of Contacts: the HTTP handlers, router, DTOs and swagger (feature `axum`) and the SQS worker that ingests contact-affecting events (feature `worker`), both driving … |
| [`contacts_outbound`](contacts_outbound/AGENTS.md) | Part of Contacts: the adapters behind `contacts_core`'s ports. |
| [`external_chat`](external_chat/AGENTS.md) | External chats: a chat from another messaging service (WhatsApp is the one provider) added to Macro as an independently shared `ExternalChat` entity. |
| [`mention_utils`](mention_utils/AGENTS.md) | Shared infrastructure for the `@mention` feature, used by messages, documents, and notifications. |
| [`messages`](messages/AGENTS.md) | The messaging/discussions feature: anchored discussions on channels and documents. |
| [`slack_integration`](slack_integration/AGENTS.md) | Part of the channels/chat (messaging) feature — lets a team bring its Slack history into Macro. |

## Recipes

- Add a crate here: create `crates/comms/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
