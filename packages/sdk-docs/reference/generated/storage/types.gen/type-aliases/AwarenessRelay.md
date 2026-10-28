# Type Alias: AwarenessRelay

> **AwarenessRelay** = \{ `databaseId`: `string`; `relayedAt`: `number`; `state`: [`Awareness`](Awareness.md); `userId`: `string`; \}

The [`AWARENESS_MESSAGE_TYPE`] payload: one viewer's awareness, stamped
when the server relayed it so receivers can drop older relays.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-databaseid"></a> `databaseId` | `string` | The database the viewer is in. |
| <a id="property-relayedat"></a> `relayedAt` | `number` | When the server relayed it, in milliseconds since the Unix epoch. |
| <a id="property-state"></a> `state` | [`Awareness`](Awareness.md) | Where the viewer is. |
| <a id="property-userid"></a> `userId` | `string` | The viewer. |
