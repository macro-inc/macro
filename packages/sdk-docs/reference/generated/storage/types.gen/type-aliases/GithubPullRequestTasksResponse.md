# Type Alias: GithubPullRequestTasksResponse

> **GithubPullRequestTasksResponse** = \{ `pullRequests`: [`GithubPullRequestTasks`](GithubPullRequestTasks.md)[]; \}

The tasks linked to each requested GitHub pull request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-pullrequests"></a> `pullRequests` | [`GithubPullRequestTasks`](GithubPullRequestTasks.md)[] | One entry per requested pull request, in request order. |
