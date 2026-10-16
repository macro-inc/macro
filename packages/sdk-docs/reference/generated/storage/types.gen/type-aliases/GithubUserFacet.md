# Type Alias: GithubUserFacet

> **GithubUserFacet** = \{ `count`: `number`; `githubUserId`: `string`; `login?`: `string` \| `null`; \}

A GitHub user among the visible pull requests, as an author or an assignee.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-count"></a> `count` | `number` | Number of visible pull requests the user opened, or is assigned to. |
| <a id="property-githubuserid"></a> `githubUserId` | `string` | The user's numeric GitHub user id. |
| <a id="property-login"></a> `login?` | `string` \| `null` | The user's most recently synced GitHub login, when known. |
