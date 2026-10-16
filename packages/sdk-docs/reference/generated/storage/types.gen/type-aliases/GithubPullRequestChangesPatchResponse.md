# Type Alias: GithubPullRequestChangesPatchResponse

> **GithubPullRequestChangesPatchResponse** = \{ `patch`: `string`; \}

Response body for `GET /github_pull_requests/{id}/changes/patch`.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-patch"></a> `patch` | `string` | The git-style unified diff of the changeset. |
