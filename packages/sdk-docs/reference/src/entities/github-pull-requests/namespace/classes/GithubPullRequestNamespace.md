# Class: GithubPullRequestNamespace

GitHub pull request snapshots and captured diffs.

## Constructors

### Constructor

> **new GithubPullRequestNamespace**(`client`): `GithubPullRequestNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`GithubPullRequestNamespace`

## Methods

### byId()

> **byId**(`id`): [`GithubPullRequest`](../../pull-request/classes/GithubPullRequest.md)

Construct from a Macro foreign entity's identity.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`GithubPullRequest`](../../pull-request/classes/GithubPullRequest.md)

***

### forEntity()

> **forEntity**(`entity`): [`GithubPullRequest`](../../pull-request/classes/GithubPullRequest.md)

Resolve a foreign entity as a pull request.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `entity` | [`ForeignEntity`](../../../foreign/foreign-entity/classes/ForeignEntity.md) |

#### Returns

[`GithubPullRequest`](../../pull-request/classes/GithubPullRequest.md)
