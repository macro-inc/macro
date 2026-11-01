# Type Alias: LoadAgentModelsResponse

> **LoadAgentModelsResponse** = \{ `currentModel?`: `string` \| `null`; `models`: [`AgentModelDto`](AgentModelDto.md)[]; `status`: [`AgentModelsStatusDto`](AgentModelsStatusDto.md); \}

Successful model-discovery response.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-currentmodel"></a> `currentModel?` | `string` \| `null` | Current provider model, if model selection is available. |
| <a id="property-models"></a> `models` | [`AgentModelDto`](AgentModelDto.md)[] | Ordered model catalog. |
| <a id="property-status"></a> `status` | [`AgentModelsStatusDto`](AgentModelsStatusDto.md) | Model-selection availability. |
