# Type Alias: GithubPullRequestTasksRequest

> **GithubPullRequestTasksRequest** = \{ `githubKeys`: `string`[]; \}

Request body for looking up the tasks linked to GitHub pull requests.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-githubkeys"></a> `githubKeys` | `string`[] | Pull request `owner/repo/pull/number` keys, at most 100. |
