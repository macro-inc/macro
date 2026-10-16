# Interface: GithubPullRequestFacets

Repositories, authors, assignees, and labels among the GitHub pull requests
visible to the caller.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-assignees"></a> `assignees` | [`GithubUserFacet`](../type-aliases/GithubUserFacet.md)[] | Assignees, most pull requests first. |
| <a id="property-authors"></a> `authors` | [`GithubUserFacet`](../type-aliases/GithubUserFacet.md)[] | Authors, most pull requests first. |
| <a id="property-labels"></a> `labels` | [`GithubLabelFacet`](../type-aliases/GithubLabelFacet.md)[] | Labels, most pull requests first. |
| <a id="property-repositories"></a> `repositories` | [`GithubRepositoryFacet`](../../../../../generated/storage/types.gen/type-aliases/GithubRepositoryFacet.md)[] | Repositories, most pull requests first. |
