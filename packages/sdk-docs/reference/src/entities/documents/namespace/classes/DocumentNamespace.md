# Class: DocumentNamespace

## Constructors

### Constructor

> **new DocumentNamespace**(`client`): `DocumentNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`DocumentNamespace`

## Methods

### byId()

> **byId**(`id`): [`Document`](../../document/classes/Document.md)

A handle to a document by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Document`](../../document/classes/Document.md)

***

### byTeamSlug()

> **byTeamSlug**(`slug`): `Promise`\<[`Document`](../../document/classes/Document.md)\>

Resolve a team task reference such as ENG-42.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `slug` | `string` |

#### Returns

`Promise`\<[`Document`](../../document/classes/Document.md)\>

***

### create()

> **create**(`opts`): `Promise`\<[`Document`](../../document/classes/Document.md)\>

Create a markdown document.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `markdown?`: `string`; `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); \} |
| `opts.markdown?` | `string` |
| `opts.name` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |

#### Returns

`Promise`\<[`Document`](../../document/classes/Document.md)\>

***

### createCanvas()

> **createCanvas**(`opts`): `Promise`\<[`Document`](../../document/classes/Document.md)\>

Create a native Canvas with shared content ready for reading and editing.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); \} |
| `opts.name` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |

#### Returns

`Promise`\<[`Document`](../../document/classes/Document.md)\>

***

### createSkill()

> **createSkill**(`opts`): `Promise`\<[`Document`](../../document/classes/Document.md)\>

Create a skill: markdown instructions that AI reads and follows.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `markdown?`: `string`; `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); \} |
| `opts.markdown?` | `string` |
| `opts.name` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |

#### Returns

`Promise`\<[`Document`](../../document/classes/Document.md)\>

***

### createSnippet()

> **createSnippet**(`opts`): `Promise`\<[`Document`](../../document/classes/Document.md)\>

Create a snippet: a reusable markdown document.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `markdown?`: `string`; `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); \} |
| `opts.markdown?` | `string` |
| `opts.name` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |

#### Returns

`Promise`\<[`Document`](../../document/classes/Document.md)\>

***

### createUpload()

> **createUpload**(`options`): `Promise`\<\{ `content`: [`DocumentContent`](../../../../../generated/storage/types.gen/type-aliases/DocumentContent.md); `contentType`: `string`; `document`: [`Document`](../../document/classes/Document.md); `uploadUrl`: `string` \| `undefined`; \}\>

Reserve a binary document and return upload instructions. Upload content before saving.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `attachment?`: [`EmailAttachment`](../../../email/attachment/classes/EmailAttachment.md); `branchedFrom?`: [`Document`](../../document/classes/Document.md); `fileType?`: `string`; `isTask?`: `boolean`; `mimeType?`: `string`; `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); `sha`: `string`; `team?`: [`Team`](../../../teams/team/classes/Team.md); \} |
| `options.attachment?` | [`EmailAttachment`](../../../email/attachment/classes/EmailAttachment.md) |
| `options.branchedFrom?` | [`Document`](../../document/classes/Document.md) |
| `options.fileType?` | `string` |
| `options.isTask?` | `boolean` |
| `options.mimeType?` | `string` |
| `options.name` | `string` |
| `options.project?` | [`Project`](../../../projects/project/classes/Project.md) |
| `options.sha` | `string` |
| `options.team?` | [`Team`](../../../teams/team/classes/Team.md) |

#### Returns

`Promise`\<\{ `content`: [`DocumentContent`](../../../../../generated/storage/types.gen/type-aliases/DocumentContent.md); `contentType`: `string`; `document`: [`Document`](../../document/classes/Document.md); `uploadUrl`: `string` \| `undefined`; \}\>

***

### recent()

> **recent**(`opts?`): `AsyncGenerator`\<[`Document`](../../document/classes/Document.md)\>

The user's recent documents, most recent first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `fileType?`: `string`; `pageSize?`: `number`; \} |
| `opts.fileType?` | `string` |
| `opts.pageSize?` | `number` |

#### Returns

`AsyncGenerator`\<[`Document`](../../document/classes/Document.md)\>

***

### recentlyDeleted()

> **recentlyDeleted**(): `Promise`\<[`Document`](../../document/classes/Document.md)[]\>

The user's recently soft-deleted documents.

#### Returns

`Promise`\<[`Document`](../../document/classes/Document.md)[]\>

***

### search()

> **search**(`query`, `opts?`): `AsyncGenerator`\<[`Document`](../../document/classes/Document.md)\>

Search documents by name and content, most relevant first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |
| `opts?` | [`SearchOpts`](../../../search/interfaces/SearchOpts.md) |

#### Returns

`AsyncGenerator`\<[`Document`](../../document/classes/Document.md)\>

***

### systemSkills()

> **systemSkills**(): `Promise`\<[`SystemSkill`](../../system-skill/classes/SystemSkill.md)[]\>

The built-in system skills: static AI instructions with no document
behind them. Unlike user skills they cannot be opened or edited.

#### Returns

`Promise`\<[`SystemSkill`](../../system-skill/classes/SystemSkill.md)[]\>

***

### validatePermissionsToken()

> **validatePermissionsToken**(`token`): `Promise`\<\{ `accessLevel`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md); `document`: [`Document`](../../document/classes/Document.md); `expiresAt`: `number`; `issuer`: `string`; `user`: [`User`](../../../users/user/classes/User.md) \| `undefined`; \}\>

Validate a permissions token, returning its document and optional user handles.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `token` | `string` |

#### Returns

`Promise`\<\{ `accessLevel`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md); `document`: [`Document`](../../document/classes/Document.md); `expiresAt`: `number`; `issuer`: `string`; `user`: [`User`](../../../users/user/classes/User.md) \| `undefined`; \}\>
