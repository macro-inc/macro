# Type Alias: GithubPullRequestTasks

> **GithubPullRequestTasks** = \{ `githubKey`: `string`; `taskIds`: `string`[]; \}

The tasks linked to one GitHub pull request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-githubkey"></a> `githubKey` | `string` | The pull request's `owner/repo/pull/number` key, as requested. |
| <a id="property-taskids"></a> `taskIds` | `string`[] | Ids of the task documents the pull request references, oldest link first. Empty when the caller cannot see the pull request. The caller may still lack access to a task. |
