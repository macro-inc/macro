# Type Alias: EnrichGithubPullRequestsResponse

> **EnrichGithubPullRequestsResponse** = \{ `pullRequests`: [`EnrichedGithubPullRequest`](EnrichedGithubPullRequest.md)[]; \}

Response body for pull request enrichment.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-pullrequests"></a> `pullRequests` | [`EnrichedGithubPullRequest`](EnrichedGithubPullRequest.md)[] | Pull requests with enrichment fields populated when GitHub data was available. |
