# Type Alias: SoupCallRecordParticipant

> **SoupCallRecordParticipant** = \{ `joinedAt`: `string`; `leftAt?`: `string` \| `null`; `userId`: `string`; \}

A Macro-account participant in a call record, as displayed in Soup.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-joinedat"></a> `joinedAt` | `string` | When the user joined the call. |
| <a id="property-leftat"></a> `leftAt?` | `string` \| `null` | When the user left (None if still in an active call). |
| <a id="property-userid"></a> `userId` | `string` | The Macro user id. |
