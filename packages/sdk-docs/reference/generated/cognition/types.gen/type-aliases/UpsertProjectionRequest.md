# Type Alias: UpsertProjectionRequest

> **UpsertProjectionRequest** = \{ `await?`: `boolean`; `expiry`: [`Expiry`](Expiry.md); `id`: `string`; `model?`: `string` \| `null`; `output_schema?`: \{\[`key`: `string`\]: `unknown`; \} \| `null`; `prompt`: `string`; `refresh_cadence`: [`RefreshCadence`](RefreshCadence.md); `regenerate?`: `boolean`; `target_type`: [`TargetType`](TargetType.md); \}

Request body for getting or creating an ai projection. The concrete target
id is resolved from the authenticated user, so only the target type is sent.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-await"></a> `await?` | `boolean` | When `true` and generation is needed (cold instance or `regenerate`), the server generates inline and responds with the finished result instead of returning immediately and pushing an update through the connection gateway. |
| <a id="property-expiry"></a> `expiry` | [`Expiry`](Expiry.md) | How long the projection remains active without being requested. |
| <a id="property-id"></a> `id` | `string` | The frontend-defined projection id (e.g. `notification_important_widget`). |
| <a id="property-model"></a> `model?` | `string` \| `null` | Optional `provider/model` id used for generation (e.g. `cerebras/llama-3.3-70b`). The default model is used when absent. |
| <a id="property-output_schema"></a> `output_schema?` | \{\[`key`: `string`\]: `unknown`; \} \| `null` | Optional JSON schema the generated result must conform to. When set, `data` holds the JSON serialization of a conforming value. Enforcement is prompted (non-strict), so it works across providers. |
| <a id="property-prompt"></a> `prompt` | `string` | The prompt used to materialize the projection. |
| <a id="property-refresh_cadence"></a> `refresh_cadence` | [`RefreshCadence`](RefreshCadence.md) | How frequently the projection should be regenerated. |
| <a id="property-regenerate"></a> `regenerate?` | `boolean` | When `true`, regenerate even if a cached result exists. |
| <a id="property-target_type"></a> `target_type` | [`TargetType`](TargetType.md) | Whether the projection is materialized for the requesting user or their team. |
