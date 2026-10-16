# Type Alias: GithubPullRequestChangesResponse

> **GithubPullRequestChangesResponse** = \{ `changeset?`: `null` \| [`ChangesetDto`](ChangesetDto.md); `error?`: `string` \| `null`; \}

Response body for `GET /github_pull_requests/{id}/changes`.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changeset"></a> `changeset?` | `null` \| [`ChangesetDto`](ChangesetDto.md) | - |
| <a id="property-error"></a> `error?` | `string` \| `null` | Why there are no changes, in a sentence the user can act on. |
