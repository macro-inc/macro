# whatsapp_session

Hosted WhatsApp linked-device protocol endpoint. Macro owns native content and
permission policy; this service owns protocol stores and durable adapter journals.

## Start here

- `internal/worker`: one independently supervised account/session.
- `internal/supervisor`: physical process fencing and authenticated control RPC.
- `internal/protocol`: bounded normalized contracts and whatsmeow conversion.
- `internal/journal`: stable command/results and adopted-group event journal.
- `patches`: exact pinned upstream transport changes; never omit during builds.

## Boundaries

- No direct writes to native channels, messages, documents, grants or search.
- Never log raw upstream errors, message bodies, identities, QR/challenges or keys.
- Protocol stores are separate encrypted databases per account. Group allowlists
  restrict Macro publication, not traffic delivered to a WhatsApp endpoint.
- Lease expiry cannot authorize a successor; reap/fence the prior process first.

## Checks

- `./go.sh test -race ./...`
- `./go.sh vet ./...`
- `./go.sh test -race go.mau.fi/whatsmeow go.mau.fi/whatsmeow/socket`

## Related

- `docs/WHATSAPP_LINKED_DEVICES.md`
