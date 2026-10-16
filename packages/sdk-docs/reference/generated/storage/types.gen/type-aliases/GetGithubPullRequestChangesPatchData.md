# Type Alias: GetGithubPullRequestChangesPatchData

> **GetGithubPullRequestChangesPatchData** = \{ `body?`: `never`; `path`: \{ `id`: `string`; \}; `query`: \{ `changeset`: `string`; \}; `url`: `"/github_pull_requests/{id}/changes/patch"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; \} | - |
| `path.id` | `string` | The caller's foreign entity record for the pull request |
| <a id="property-query"></a> `query` | \{ `changeset`: `string`; \} | - |
| `query.changeset` | `string` | The changeset whose patch to read |
| <a id="property-url"></a> `url` | `"/github_pull_requests/{id}/changes/patch"` | - |
