# Type Alias: ConversationSeal

> **ConversationSeal** = \{ `manifestSha256`: [`Sha256Digest`](Sha256Digest.md); `partCount`: `number`; `slackChannelId`: [`ConversationId`](ConversationId.md); \}

Complete immutable expected part set for one conversation, including zero parts.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-manifestsha256"></a> `manifestSha256` | [`Sha256Digest`](Sha256Digest.md) | SHA-256 of canonical descriptor lines; zero parts hash the empty byte string. |
| <a id="property-partcount"></a> `partCount` | `number` | Exact number of registered parts, starting at index zero. |
| <a id="property-slackchannelid"></a> `slackChannelId` | [`ConversationId`](ConversationId.md) | Selected source conversation. |
