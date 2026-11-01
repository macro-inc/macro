# Type Alias: ChatMessageWithAttachments

> **ChatMessageWithAttachments** = \{ `attachments`: [`Entity`](Entity.md)[]; `content`: [`ChatMessageContent`](ChatMessageContent.md); `id`: `string`; `role`: [`Role`](Role.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments` | [`Entity`](Entity.md)[] | The ids of the attachments used to generate the message |
| <a id="property-content"></a> `content` | [`ChatMessageContent`](ChatMessageContent.md) | Message content |
| <a id="property-id"></a> `id` | `string` | The chat message id |
| <a id="property-role"></a> `role` | [`Role`](Role.md) | Whether the chat is from the user or system |
