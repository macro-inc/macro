# Type Alias: CallRecordParticipant

> **CallRecordParticipant** = \{ `joinedAt`: `string`; `leftAt?`: `string` \| `null`; `userId`: `string`; \}

A participant as returned in a [`CallRecord`] (historic — includes `left_at`).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-joinedat"></a> `joinedAt` | `string` | When the user joined the call. |
| <a id="property-leftat"></a> `leftAt?` | `string` \| `null` | When the user left (None if still in an active call). |
| <a id="property-userid"></a> `userId` | `string` | The Macro user id. |
