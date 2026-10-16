# Type Alias: ProjectionStateResponse

> **ProjectionStateResponse** = \{ `data?`: `string` \| `null`; `error?`: `string` \| `null`; `generated_at?`: `string` \| `null`; `id`: `string`; `stale_at?`: `string` \| `null`; `status`: [`ProjectionStatus`](ProjectionStatus.md); \}

The current state of a user's projection instance.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-data"></a> `data?` | `string` \| `null` | The cached result, if any. JSON-encoded when the projection defines an `output_schema`. |
| <a id="property-error"></a> `error?` | `string` \| `null` | The most recent materialization error, if any. |
| <a id="property-generated_at"></a> `generated_at?` | `string` \| `null` | When the result was generated. |
| <a id="property-id"></a> `id` | `string` | The projection id. |
| <a id="property-stale_at"></a> `stale_at?` | `string` \| `null` | When the result becomes stale. |
| <a id="property-status"></a> `status` | [`ProjectionStatus`](ProjectionStatus.md) | The materialization status. |
