# Type Alias: Step

> **Step** = \{ `asReply?`: `boolean`; `body`: `string`; `delayDays`: `number`; `subject`: `string`; \}

One email of a sequence. A sequence holds templates; an enrollment holds
them rendered for its contact.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-asreply"></a> `asReply?` | `boolean` | Send as a reply in the previous email's thread. |
| <a id="property-body"></a> `body` | `string` | Plain-text body. |
| <a id="property-delaydays"></a> `delayDays` | `number` | Calendar days after the previous step, at the enrollment's send time. |
| <a id="property-subject"></a> `subject` | `string` | Subject line; a reply step uses its thread's subject instead. |
