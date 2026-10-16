# Type Alias: GithubPullRequestCheckRun

> **GithubPullRequestCheckRun** = \{ `completedAt?`: `string` \| `null`; `conclusion?`: `string` \| `null`; `id`: `number`; `name`: `string`; `startedAt?`: `string` \| `null`; `status`: `string`; `url?`: `string` \| `null`; \}

A check run associated with a GitHub pull request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-completedat"></a> `completedAt?` | `string` \| `null` | When the check run completed, when available. |
| <a id="property-conclusion"></a> `conclusion?` | `string` \| `null` | The raw GitHub check run conclusion, when the run has completed. |
| <a id="property-id"></a> `id` | `number` | The unique GitHub identifier for the check run. |
| <a id="property-name"></a> `name` | `string` | The check run name. |
| <a id="property-startedat"></a> `startedAt?` | `string` \| `null` | When the check run started, when available. |
| <a id="property-status"></a> `status` | `string` | The raw GitHub check run status. |
| <a id="property-url"></a> `url?` | `string` \| `null` | The public GitHub URL for the check run, when available. |
