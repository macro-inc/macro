# Type Alias: SearchWebErrors

> **SearchWebErrors** = \{ `400`: [`WebSearchErrorBody`](WebSearchErrorBody.md); `401`: `unknown`; `402`: [`WebSearchErrorBody`](WebSearchErrorBody.md); `429`: [`WebSearchErrorBody`](WebSearchErrorBody.md); `502`: [`WebSearchErrorBody`](WebSearchErrorBody.md); `503`: [`WebSearchErrorBody`](WebSearchErrorBody.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`WebSearchErrorBody`](WebSearchErrorBody.md) | Invalid query, domains, or result limit |
| <a id="property-401"></a> `401` | `unknown` | Unauthorized |
| <a id="property-402"></a> `402` | [`WebSearchErrorBody`](WebSearchErrorBody.md) | AI allowance exhausted |
| <a id="property-429"></a> `429` | [`WebSearchErrorBody`](WebSearchErrorBody.md) | The search provider is rate limiting searches |
| <a id="property-502"></a> `502` | [`WebSearchErrorBody`](WebSearchErrorBody.md) | The search provider failed |
| <a id="property-503"></a> `503` | [`WebSearchErrorBody`](WebSearchErrorBody.md) | Usage validation unavailable |
