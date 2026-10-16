# Type Alias: AgentRepositoryDto

> **AgentRepositoryDto** = \{ `defaultBranch?`: `string` \| `null`; `url`: `string`; \}

One repository the caller can select for a coding session.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-defaultbranch"></a> `defaultBranch?` | `string` \| `null` | The branch a clone checks out, and where a session starts when its request selects this repository without a `repoBranch`. Absent for a repository with no commits. |
| <a id="property-url"></a> `url` | `string` | The canonical `https://github.com/owner/name` url, in the form `POST /agent-sessions` accepts as `repoUrl`. |
