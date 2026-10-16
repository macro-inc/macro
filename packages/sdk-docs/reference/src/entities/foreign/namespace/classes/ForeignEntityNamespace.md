# Class: ForeignEntityNamespace

## Constructors

### Constructor

> **new ForeignEntityNamespace**(`client`): `ForeignEntityNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`ForeignEntityNamespace`

## Methods

### byId()

> **byId**(`id`): [`ForeignEntity`](../../foreign-entity/classes/ForeignEntity.md)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`ForeignEntity`](../../foreign-entity/classes/ForeignEntity.md)

***

### bySource()

> **bySource**(`source`, `foreignEntityId`): `Promise`\<[`ForeignEntity`](../../foreign-entity/classes/ForeignEntity.md)\>

Look a foreign entity up by the identifier its source system assigned.

`foreignEntityId` may contain slashes — sources store them inside the
identifier, for example `owner/repo/pull/12`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `source` | `string` |
| `foreignEntityId` | `string` |

#### Returns

`Promise`\<[`ForeignEntity`](../../foreign-entity/classes/ForeignEntity.md)\>

***

### githubPullRequestFacets()

> **githubPullRequestFacets**(): `Promise`\<[`GithubPullRequestFacets`](../interfaces/GithubPullRequestFacets.md)\>

Repositories, authors, assignees, and labels among the GitHub pull
requests visible to the authenticated user and their team, each with how
many pull requests it covers. A pull request visible to both the user and
the team counts once.

#### Returns

`Promise`\<[`GithubPullRequestFacets`](../interfaces/GithubPullRequestFacets.md)\>
