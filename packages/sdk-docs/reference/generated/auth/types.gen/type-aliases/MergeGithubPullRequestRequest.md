# Type Alias: MergeGithubPullRequestRequest

> **MergeGithubPullRequestRequest** = \{ `mergeMethod?`: `null` \| [`GithubMergeMethod`](GithubMergeMethod.md); `number`: `number`; `owner`: `string`; `repo`: `string`; \}

A request to merge one pull request on the user's behalf.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-mergemethod"></a> `mergeMethod?` | `null` \| [`GithubMergeMethod`](GithubMergeMethod.md) | - |
| <a id="property-number"></a> `number` | `number` | The GitHub pull request number. |
| <a id="property-owner"></a> `owner` | `string` | The GitHub repository owner or organization. |
| <a id="property-repo"></a> `repo` | `string` | The GitHub repository name. |
