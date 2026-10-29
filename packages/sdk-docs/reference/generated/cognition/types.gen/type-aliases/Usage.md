# Type Alias: Usage

> **Usage** = \{ `audio_seconds?`: `number` \| `null`; `cache_read_input_tokens`: `number`; `cache_write_input_tokens`: `number`; `created_at`: `string`; `input_tokens`: `number`; `model`: `string`; `output_tokens`: `number`; `price?`: `null` \| [`Price`](Price.md); \}

Measured usage for one invocation.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-audio_seconds"></a> `audio_seconds?` | `number` \| `null` | Audio duration in seconds, absent for token billing. |
| <a id="property-cache_read_input_tokens"></a> `cache_read_input_tokens` | `number` | Input tokens read from a prompt cache; zero for audio billing. |
| <a id="property-cache_write_input_tokens"></a> `cache_write_input_tokens` | `number` | Input tokens written to a prompt cache; zero for audio billing. |
| <a id="property-created_at"></a> `created_at` | `string` | Recording timestamp. |
| <a id="property-input_tokens"></a> `input_tokens` | `number` | Uncached input tokens; zero for audio billing. |
| <a id="property-model"></a> `model` | `string` | Provider model identifier. |
| <a id="property-output_tokens"></a> `output_tokens` | `number` | Output tokens; zero for audio billing. |
| <a id="property-price"></a> `price?` | `null` \| [`Price`](Price.md) | - |
