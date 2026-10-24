# Type Alias: WhatsappGroupMessageMetadata

> **WhatsappGroupMessageMetadata** = \{ `groupName`: `string`; `messageId`: `string`; \}

A live message in an independently shared WhatsApp group.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-groupname"></a> `groupName` | `string` | Group name, independent of its remote subject. |
| <a id="property-messageid"></a> `messageId` | `string` | Stable message id; retries use it as their notification id. |
