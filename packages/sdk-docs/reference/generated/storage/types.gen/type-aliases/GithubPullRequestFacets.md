# Type Alias: GithubPullRequestFacets

> **GithubPullRequestFacets** = \{ `assignees`: [`GithubUserFacet`](GithubUserFacet.md)[]; `authors`: [`GithubUserFacet`](GithubUserFacet.md)[]; `labels`: [`GithubLabelFacet`](GithubLabelFacet.md)[]; `repositories`: [`GithubRepositoryFacet`](GithubRepositoryFacet.md)[]; \}

Repositories, authors, assignees, and labels among the GitHub pull requests a caller can see,
each with the number of pull requests it covers.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-assignees"></a> `assignees` | [`GithubUserFacet`](GithubUserFacet.md)[] | Assignees, most pull requests first. |
| <a id="property-authors"></a> `authors` | [`GithubUserFacet`](GithubUserFacet.md)[] | Authors, most pull requests first. |
| <a id="property-labels"></a> `labels` | [`GithubLabelFacet`](GithubLabelFacet.md)[] | Labels, most pull requests first. |
| <a id="property-repositories"></a> `repositories` | [`GithubRepositoryFacet`](GithubRepositoryFacet.md)[] | Repositories, most pull requests first. |
