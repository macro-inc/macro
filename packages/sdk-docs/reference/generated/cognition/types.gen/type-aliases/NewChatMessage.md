# Type Alias: NewChatMessage

> **NewChatMessage** = \{ `attachments?`: [`NewAttachment`](NewAttachment.md)[] \| `null`; `content`: [`ChatMessageContent`](ChatMessageContent.md); `createdAt`: `string`; `id?`: `string` \| `null`; `model`: `string`; `role`: [`Role`](Role.md); `updatedAt`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments?` | [`NewAttachment`](NewAttachment.md)[] \| `null` | The ids of the attachments used to generate the message |
| <a id="property-content"></a> `content` | [`ChatMessageContent`](ChatMessageContent.md) | Content of the message |
| <a id="property-createdat"></a> `createdAt` | `string` | - |
| <a id="property-id"></a> `id?` | `string` \| `null` | Optional pre-generated ID. If None, the database generates one. |
| <a id="property-model"></a> `model` | `string` | The model used to generate the chat (provider api id) |
| <a id="property-role"></a> `role` | [`Role`](Role.md) | Whether the chat is from the user or system |
| <a id="property-updatedat"></a> `updatedAt` | `string` | - |
