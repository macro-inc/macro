# Class: PullRequestChangeset

One captured diff belonging to a pull request.

## Constructors

### Constructor

> **new PullRequestChangeset**(`client`, `pullRequest`, `record`): `PullRequestChangeset`

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `client` | `MacroClient` | - |
| `pullRequest` | [`GithubPullRequest`](GithubPullRequest.md) | Parent pull request. |
| `record` | [`ChangesetDto`](../../../../../generated/storage/types.gen/type-aliases/ChangesetDto.md) | Captured metadata. |

#### Returns

`PullRequestChangeset`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-pullrequest"></a> `pullRequest` | `readonly` | [`GithubPullRequest`](GithubPullRequest.md) | Parent pull request. |
| <a id="property-record"></a> `record` | `readonly` | [`ChangesetDto`](../../../../../generated/storage/types.gen/type-aliases/ChangesetDto.md) | Captured metadata. |

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Captured identity.

##### Returns

`string`

## Methods

### patch()

> **patch**(): `Promise`\<`string`\>

Read the captured unified patch.

#### Returns

`Promise`\<`string`\>

***

### toJSON()

> **toJSON**(): \{ `additions`: `number`; `base`: [`GitRefDto`](../../../../../generated/storage/types.gen/type-aliases/GitRefDto.md); `capturedAt`: `string`; `deletions`: `number`; `files`: [`ChangedFileDto`](../../../../../generated/storage/types.gen/type-aliases/ChangedFileDto.md)[]; `head`: [`GitRefDto`](../../../../../generated/storage/types.gen/type-aliases/GitRefDto.md); `id`: `string`; `patchBytes`: `number`; `pullRequestId`: `string`; `repository?`: `string` \| `null`; `source`: `"github_pull_request"`; `truncated`: `boolean`; \}

Serialize captured metadata and parent identity.

#### Returns

| Name | Type | Description |
| ------ | ------ | ------ |
| `additions` | `number` | Lines added across all files. |
| `base` | [`GitRefDto`](../../../../../generated/storage/types.gen/type-aliases/GitRefDto.md) | The side the work started from. |
| `capturedAt` | `string` | When the diff was taken. |
| `deletions` | `number` | Lines removed across all files. |
| `files` | [`ChangedFileDto`](../../../../../generated/storage/types.gen/type-aliases/ChangedFileDto.md)[] | Every changed file, in patch order. |
| `head` | [`GitRefDto`](../../../../../generated/storage/types.gen/type-aliases/GitRefDto.md) | The side carrying the work. |
| `id` | `string` | The changeset's id; a different id means different changes. |
| `patchBytes` | `number` | Size of the patch the matching patch route serves; zero when nothing changed. |
| `pullRequestId` | `string` | - |
| `repository?` | `string` \| `null` | `https://github.com/owner/name`, when known. |
| `source` | `"github_pull_request"` | Where the diff was read from. |
| `truncated` | `boolean` | Some files' hunks were left out of the patch. |
