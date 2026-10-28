# Type Alias: Price

> **Price** = \{ `price_per_audio_minute?`: `number` \| `null`; `price_per_million_cache_read?`: `number` \| `null`; `price_per_million_cache_write?`: `number` \| `null`; `price_per_million_in`: `number`; `price_per_million_out`: `number`; `total`: `number`; \}

Rates applied to an invocation and its resolved dollar cost.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-price_per_audio_minute"></a> `price_per_audio_minute?` | `number` \| `null` | Price per audio minute (USD), absent for token billing. |
| <a id="property-price_per_million_cache_read"></a> `price_per_million_cache_read?` | `number` \| `null` | Price per million cache-read input tokens (USD), absent when the model has no published rate and for audio billing. |
| <a id="property-price_per_million_cache_write"></a> `price_per_million_cache_write?` | `number` \| `null` | Price per million cache-write input tokens (USD), absent when the model has no published rate and for audio billing. |
| <a id="property-price_per_million_in"></a> `price_per_million_in` | `number` | Price per million input tokens (USD); zero for audio billing. |
| <a id="property-price_per_million_out"></a> `price_per_million_out` | `number` | Price per million output tokens (USD); zero for audio billing. |
| <a id="property-total"></a> `total` | `number` | Total cost (USD). |
