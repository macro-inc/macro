# Personal WhatsApp UI

Use the existing Settings, channel creation, composer and Participants surfaces.
Keep one Panel root inside the channel dialog while switching between creation
and group selection, with search and explicit audience review. The composer uses
the channel name; keep account numbers and raw provider IDs out of its normal chrome.
Personal accounts have no Business API reply windows, templates or human-support
modes. Keep server permission denials distinct from those Business-only states.
The native source marker selects this transport; ordinary channels do not issue
linked-device queries. Shared queries/mutations live in `lib/queries/whatsapp-linked`;
HTTP contracts come from DSS OpenAPI, not handwritten wire types.

Pairing material stays in a focused `ph-no-capture` dialog and nonpersistent query
cache. Desktop handoff carries only the owner-bound expiring flow identifier.
A draft is scoped by user, channel, account and authorization generation. Human
submission is required; never silently post internally or choose another sender.

Run the focused messaging Vitest and bundled functional browser journeys. See
`docs/WHATSAPP_LINKED_DEVICES.md` and `docs/agent-guide/channels.md` for behavior,
rollout, verification and platform qualification.
