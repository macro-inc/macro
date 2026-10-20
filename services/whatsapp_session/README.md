# WhatsApp session service

Use the [operator and developer guide](../../docs/WHATSAPP_LINKED_DEVICES.md).
The service is opt-in and has no public gateway endpoint. Build/test only with
`./go.sh` so the pinned writer/ambiguous-send patch cannot be omitted.

```sh
./go.sh test -race ./...
./go.sh test -race go.mau.fi/whatsmeow go.mau.fi/whatsmeow/socket
./go.sh vet ./...
```

Set `WHATSAPP_TEST_DATABASE_URL` to a disposable, fully migrated MacroDB to run the
real-process supervisor/retirement test; otherwise that one test explicitly skips.
No automated suite connects to WhatsApp or KMS. The injected KMS double and synthetic identities
are only test fixtures. Deployment remains gated on the prerequisites and
[license review](THIRD_PARTY_NOTICES.md).

For live localhost use, follow [the local setup section](../../docs/WHATSAPP_LINKED_DEVICES.md#live-testing-on-localhost).
The app and session service can run locally with LocalStack KMS. Reaching the QR
does not connect an account: the user scans and approves the link on their phone.
