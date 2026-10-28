# Type Alias: SetGithubPullRequestDraftRequest

> **SetGithubPullRequestDraftRequest** = \{ `draft`: `boolean`; `number`: `number`; `owner`: `string`; `repo`: `string`; \}

A request to mark one pull request as a draft, or as ready for review, on
the user's behalf.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-draft"></a> `draft` | `boolean` | `true` converts the pull request to a draft; `false` marks it ready for review. |
| <a id="property-number"></a> `number` | `number` | The GitHub pull request number. |
| <a id="property-owner"></a> `owner` | `string` | The GitHub repository owner or organization. |
| <a id="property-repo"></a> `repo` | `string` | The GitHub repository name. |
