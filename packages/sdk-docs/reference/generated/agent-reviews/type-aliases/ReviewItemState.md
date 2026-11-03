# Type Alias: ReviewItemState

> **ReviewItemState** = \{ `edited?`: `boolean`; `error`: `string` \| `null`; `id`: `string`; `status`: [`ItemStatus`](ItemStatus.md); \}

Item facts every kind shares.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-edited"></a> `edited?` | `boolean` | Whether the account holder edited this draft before deciding. |
| <a id="property-error"></a> `error` | `string` \| `null` | Failure or uncertainty description. |
| <a id="property-id"></a> `id` | `string` | Stable item identity across stack navigation and edits. |
| <a id="property-status"></a> `status` | [`ItemStatus`](ItemStatus.md) | Current outcome. |
