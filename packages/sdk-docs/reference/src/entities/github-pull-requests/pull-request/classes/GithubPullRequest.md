# Class: GithubPullRequest

A stored GitHub pull request addressed by its Macro foreign entity.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`StoredGithubPullRequest`](../../../../../generated/storage/types.gen/type-aliases/StoredGithubPullRequest.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<`NonNullable`\<`"open"` \| `"closed"` \| `"merged"` \| `null` \| `undefined`\> \| `undefined`\> | Current state. | - |
| <a id="property-title"></a> `title` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Pull request title. | - |
| <a id="property-url"></a> `url` | `readonly` | () => `Promise`\<`string`\> | GitHub URL. | - |

## Methods

### changes()

> **changes**(): `Promise`\<\{ `changeset?`: [`PullRequestChangeset`](PullRequestChangeset.md); `error?`: `string`; \}\>

Captured change metadata, when available.

#### Returns

`Promise`\<\{ `changeset?`: [`PullRequestChangeset`](PullRequestChangeset.md); `error?`: `string`; \}\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`StoredGithubPullRequest`](../../../../../generated/storage/types.gen/type-aliases/StoredGithubPullRequest.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`StoredGithubPullRequest`](../../../../../generated/storage/types.gen/type-aliases/StoredGithubPullRequest.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`StoredGithubPullRequest`](../../../../../generated/storage/types.gen/type-aliases/StoredGithubPullRequest.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `GithubPullRequest`

Construct a lazy pull request handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`GithubPullRequest`
