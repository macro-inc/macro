# Type Alias: LinkedPairState

> **LinkedPairState** = \{ `challenge?`: \{\[`key`: `string`\]: `unknown`; \} \| `null`; `code?`: `string` \| `null`; `expiresAt`: `string`; `identityJid?`: `string` \| `null`; `qr?`: `string` \| `null`; `state`: [`LinkedPairingState`](LinkedPairingState.md); \}

Owner-only pairing status. Deliberately has no `Debug` implementation: the
QR and pairing code are secrets for the duration of the transaction.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-challenge"></a> `challenge?` | \{\[`key`: `string`\]: `unknown`; \} \| `null` | WhatsApp's WebAuthn request options while the state is `passkey`; the native authenticator answers through the passkey route. |
| <a id="property-code"></a> `code?` | `string` \| `null` | Pairing code to type on the phone, when phone-number pairing is used. |
| <a id="property-expiresat"></a> `expiresAt` | `string` | Same owner-bound deadline. |
| <a id="property-identityjid"></a> `identityJid?` | `string` \| `null` | Verified identity once paired. |
| <a id="property-qr"></a> `qr?` | `string` \| `null` | Current QR content; rotates while the transaction waits. |
| <a id="property-state"></a> `state` | [`LinkedPairingState`](LinkedPairingState.md) | Current state. |
