# Type Alias: EnrichGithubPullRequestsProxyRequest

> **EnrichGithubPullRequestsProxyRequest** = \{ `pullRequests`: [`GithubPullRequestRef`](GithubPullRequestRef.md)[]; \}

Request body for the authenticated pull request enrichment proxy.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-pullrequests"></a> `pullRequests` | [`GithubPullRequestRef`](GithubPullRequestRef.md)[] | The pull requests to enrich for the authenticated user. |
