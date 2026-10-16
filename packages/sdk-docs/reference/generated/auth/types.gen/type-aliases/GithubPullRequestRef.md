# Type Alias: GithubPullRequestRef

> **GithubPullRequestRef** = \{ `displayName`: `string`; `githubKey`: `string`; `number`: `number`; `owner`: `string`; `repo`: `string`; `url`: `string`; \}

A pull request reference that can be enriched with live GitHub data.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-displayname"></a> `displayName` | `string` | A compact label suitable for display in the UI. |
| <a id="property-githubkey"></a> `githubKey` | `string` | The stored GitHub association key, in `owner/repo/pull/number` format. |
| <a id="property-number"></a> `number` | `number` | The GitHub pull request number. |
| <a id="property-owner"></a> `owner` | `string` | The GitHub repository owner or organization. |
| <a id="property-repo"></a> `repo` | `string` | The GitHub repository name. |
| <a id="property-url"></a> `url` | `string` | The public GitHub URL for the pull request. |
