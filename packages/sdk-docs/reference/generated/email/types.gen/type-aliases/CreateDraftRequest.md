# Type Alias: CreateDraftRequest

> **CreateDraftRequest** = \{ `draft`: [`ApiDraftInput`](ApiDraftInput.md); `send_time?`: `string` \| `null`; \}

Request body for creating a draft.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-draft"></a> `draft` | [`ApiDraftInput`](ApiDraftInput.md) | The draft content. |
| <a id="property-send_time"></a> `send_time?` | `string` \| `null` | Scheduled send time. |
