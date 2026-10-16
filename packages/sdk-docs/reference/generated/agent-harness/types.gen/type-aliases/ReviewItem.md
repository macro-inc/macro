# Type Alias: ReviewItem

> **ReviewItem** = \{ `draft`: `unknown`; `error?`: `string` \| `null`; `id`: `string`; `result?`: `unknown`; `status`: [`ReviewItemStatus`](ReviewItemStatus.md); \}

One editable item and its durable outcome.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-draft"></a> `draft` | `unknown` | Validated arguments for the existing composer/action. |
| <a id="property-error"></a> `error?` | `string` \| `null` | Failure or uncertainty description. |
| <a id="property-id"></a> `id` | `string` | Stable item identity across stack navigation and edits. |
| <a id="property-result"></a> `result?` | `unknown` | Actual backend response, never a model assertion. |
| <a id="property-status"></a> `status` | [`ReviewItemStatus`](ReviewItemStatus.md) | Current outcome. |
