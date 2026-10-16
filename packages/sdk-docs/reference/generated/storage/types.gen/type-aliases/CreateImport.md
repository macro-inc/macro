# Type Alias: CreateImport

> **CreateImport** = \{ `conversations`: [`ConversationMetadata`](ConversationMetadata.md)[]; `idempotencyToken`: [`CreateToken`](CreateToken.md); `includeMessageHistory`: `boolean`; `source`: [`SourceIdentity`](SourceIdentity.md); \}

Create command. Team identity is deliberately absent.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-conversations"></a> `conversations` | [`ConversationMetadata`](ConversationMetadata.md)[] | Full, unique selected conversations (at most the configured bound). |
| <a id="property-idempotencytoken"></a> `idempotencyToken` | [`CreateToken`](CreateToken.md) | Replay with the same semantic payload returns the original job; changes conflict. |
| <a id="property-includemessagehistory"></a> `includeMessageHistory` | `boolean` | Default true at the client; false still requires users and zero-part seals. |
| <a id="property-source"></a> `source` | [`SourceIdentity`](SourceIdentity.md) | Binding or explicit unknown-source confirmation. |
