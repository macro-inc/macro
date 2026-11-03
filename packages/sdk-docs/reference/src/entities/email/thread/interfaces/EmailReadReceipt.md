# Interface: EmailReadReceipt

Open tracking for one of the caller's sent messages.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-firstopenedat"></a> `firstOpenedAt?` | `string` | When the first counted fetch happened, if any. |
| <a id="property-lastopenedat"></a> `lastOpenedAt?` | `string` | When the latest counted fetch happened, if any. |
| <a id="property-message"></a> `message` | [`EmailMessage`](../../message/classes/EmailMessage.md) | The tracked message. |
| <a id="property-opencount"></a> `openCount` | `number` | Counted pixel fetches; repeats within a few seconds count once. |
