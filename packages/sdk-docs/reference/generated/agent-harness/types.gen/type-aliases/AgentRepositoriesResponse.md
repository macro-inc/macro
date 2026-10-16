# Type Alias: AgentRepositoriesResponse

> **AgentRepositoriesResponse** = \{ `repositories`: [`AgentRepositoryDto`](AgentRepositoryDto.md)[]; \}

Response body for `GET /agent-repositories`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-repositories"></a> `repositories` | [`AgentRepositoryDto`](AgentRepositoryDto.md)[] | Every repository the caller reaches through Macro's GitHub App, sorted by `owner/name`. Empty when the App is installed nowhere the caller has a claim to. |
