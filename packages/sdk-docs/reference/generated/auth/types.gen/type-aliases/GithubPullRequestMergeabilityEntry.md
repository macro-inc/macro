# Type Alias: GithubPullRequestMergeabilityEntry

> **GithubPullRequestMergeabilityEntry** = \{ `mergeability`: [`GithubPullRequestMergeability`](GithubPullRequestMergeability.md); `number`: `number`; `owner`: `string`; `repo`: `string`; \}

One pull request's mergeability.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-mergeability"></a> `mergeability` | [`GithubPullRequestMergeability`](GithubPullRequestMergeability.md) | Whether the head merges cleanly into the base. |
| <a id="property-number"></a> `number` | `number` | The GitHub pull request number. |
| <a id="property-owner"></a> `owner` | `string` | The GitHub repository owner or organization. |
| <a id="property-repo"></a> `repo` | `string` | The GitHub repository name. |
