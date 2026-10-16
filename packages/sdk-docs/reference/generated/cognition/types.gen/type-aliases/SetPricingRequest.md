# Type Alias: SetPricingRequest

> **SetPricingRequest** = \{ `model`: `string`; `price_per_audio_minute?`: `number` \| `null`; `price_per_mil_cache_read?`: `number` \| `null`; `price_per_mil_cache_write?`: `number` \| `null`; `price_per_mil_in?`: `number` \| `null`; `price_per_mil_out?`: `number` \| `null`; \}

Request body for [`set_pricing_handler`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-model"></a> `model` | `string` | The model api id to (re)price. |
| <a id="property-price_per_audio_minute"></a> `price_per_audio_minute?` | `number` \| `null` | Price per minute of audio (USD), or null for token-only pricing. |
| <a id="property-price_per_mil_cache_read"></a> `price_per_mil_cache_read?` | `number` \| `null` | Price per million cache-read input tokens (USD). Omit it when the model has no published rate: calls that report cache reads then stay unpriced. |
| <a id="property-price_per_mil_cache_write"></a> `price_per_mil_cache_write?` | `number` \| `null` | Price per million cache-write input tokens (USD). Omit it when the model has no published rate: calls that report cache writes then stay unpriced. |
| <a id="property-price_per_mil_in"></a> `price_per_mil_in?` | `number` \| `null` | New price per million input tokens (USD). Required for token pricing. |
| <a id="property-price_per_mil_out"></a> `price_per_mil_out?` | `number` \| `null` | New price per million output tokens (USD). Required for token pricing. |
