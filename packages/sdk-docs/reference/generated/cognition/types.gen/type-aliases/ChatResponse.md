# Type Alias: ChatResponse

> **ChatResponse** = \{ `createdAt?`: `string` \| `null`; `id`: `string`; `messages`: [`ChatMessageWithAttachments`](ChatMessageWithAttachments.md)[]; `model?`: `string` \| `null`; `name`: `string`; `projectId?`: `string` \| `null`; `updatedAt?`: `string` \| `null`; `userId`: `string`; \}

The full chat response, matching the DCS API response shape.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt?` | `string` \| `null` | The time the chat was created. |
| <a id="property-id"></a> `id` | `string` | The chat uuid. |
| <a id="property-messages"></a> `messages` | [`ChatMessageWithAttachments`](ChatMessageWithAttachments.md)[] | The messages in the chat. |
| <a id="property-model"></a> `model?` | `string` \| `null` | The model used to generate the chat (`provider/model` id). |
| <a id="property-name"></a> `name` | `string` | The name of the chat. |
| <a id="property-projectid"></a> `projectId?` | `string` \| `null` | The project id the chat belongs to. |
| <a id="property-updatedat"></a> `updatedAt?` | `string` \| `null` | The time the chat was last updated. |
| <a id="property-userid"></a> `userId` | `string` | Who the chat belongs to. |
