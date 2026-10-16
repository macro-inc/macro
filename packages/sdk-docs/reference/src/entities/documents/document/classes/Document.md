# Class: Document

A Macro document. Can be dropped into a msg template to render an
inline link to the document.

## Extends

- [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md)\<`DocumentDetail`\>

## Extended by

- [`Task`](../../../tasks/task/classes/Task.md)

## Implements

- [`Mentionable`](../../../../mentions/interfaces/Mentionable.md)

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-branchedfrom"></a> `branchedFrom` | `readonly` | () => `Promise`\<`Document` \| `undefined`\> | `...` | The document this one was branched from, if any. | - | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the document was created. | - | - |
| <a id="property-deletedat"></a> `deletedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the document was deleted, if it has been. | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"document"` | `'document'` | Favorites identify documents as `document`. | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`entityType`](../../../entity/classes/PropertiedEntity.md#property-entitytype) | - |
| <a id="property-filetype"></a> `fileType` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | The document's file type (e.g. `md`, `pdf`, `docx`). | - | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`id`](../../../entity/classes/PropertiedEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | `...` | The document's display name. | - | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | `...` | The user who owns the document. | - | - |
| <a id="property-project"></a> `project` | `readonly` | () => `Promise`\<[`Project`](../../../projects/project/classes/Project.md) \| `undefined`\> | `...` | The project this document belongs to, if any. | - | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the document was last updated. | - | - |
| <a id="property-search"></a> `search` | `static` | (`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`Document`\> | `...` | Search documents by name and content, most relevant first, auto-paginated. | - | - |

## Methods

### branchName()

> **branchName**(): `Promise`\<`string`\>

The git branch name derived for the document (task documents).

#### Returns

`Promise`\<`string`\>

***

### comment()

> **comment**(`body`, `opts?`): `Promise`\<[`Comment`](../../comment/classes/Comment.md)\>

Add a comment. Starts a new unanchored thread, or replies to an existing
one when `threadId` (the thread's root comment id) is given.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) | Plain text, or a rich body composed with msg. |
| `opts?` | \{ `threadId?`: `string`; \} | - |
| `opts.threadId?` | `string` | - |

#### Returns

`Promise`\<[`Comment`](../../comment/classes/Comment.md)\>

The created comment.

***

### comments()

> **comments**(): `Promise`\<[`CommentThread`](../interfaces/CommentThread.md)[]\>

The document's live comment threads, each with its comments, newest thread first.

#### Returns

`Promise`\<[`CommentThread`](../interfaces/CommentThread.md)[]\>

***

### content()

> **content**(): `Promise`\<`string`\>

Current Markdown for native documents, extracted text for PDF/Word,
or raw file content for other formats. Native reads include live edits.

#### Returns

`Promise`\<`string`\>

***

### copy()

> **copy**(`opts`): `Promise`\<`Document`\>

Copy the document under a new name, optionally from a specific version.
Returns a handle to the new document.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `name`: `string`; `versionId?`: `number`; \} |
| `opts.name` | `string` |
| `opts.versionId?` | `number` |

#### Returns

`Promise`\<`Document`\>

***

### delete()

> **delete**(`opts?`): `Promise`\<`void`\>

Delete the document. Soft by default (reversible with [restore](#restore));
pass `permanent: true` to delete irreversibly.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `permanent?`: `boolean`; \} |
| `opts.permanent?` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

### deleteProperty()

> **deleteProperty**(`assignment`): `Promise`\<`void`\>

Remove a property from this entity, given its [properties](#properties) entry.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `assignment` | [`EntityPropertyWithDefinition`](../../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md) |

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`deleteProperty`](../../../entity/classes/PropertiedEntity.md#deleteproperty)

***

### favorite()

> **favorite**(): `Promise`\<`Document`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`Document`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`favorite`](../../../entity/classes/PropertiedEntity.md#favorite)

***

### githubPullRequests()

> **githubPullRequests**(): `Promise`\<[`GithubPullRequest`](../../../../../generated/storage/types.gen/type-aliases/GithubPullRequest.md)[]\>

GitHub pull requests associated with the document.

#### Returns

`Promise`\<[`GithubPullRequest`](../../../../../generated/storage/types.gen/type-aliases/GithubPullRequest.md)[]\>

***

### move()

> **move**(`project`): `Promise`\<`void`\>

Move the document into a project (or out of one, with `null`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `project` | [`Project`](../../../projects/project/classes/Project.md) \| `null` |

#### Returns

`Promise`\<`void`\>

***

### properties()

> **properties**(`opts?`): `Promise`\<[`EntityPropertyWithDefinition`](../../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md)[]\>

The properties set on this entity, each with its definition, value, and options.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `includeMetadata?`: `boolean`; \} |
| `opts.includeMetadata?` | `boolean` |

#### Returns

`Promise`\<[`EntityPropertyWithDefinition`](../../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md)[]\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`properties`](../../../entity/classes/PropertiedEntity.md#properties)

***

### propertyReference()

> **propertyReference**(): [`PropertyTargetReference`](../../../../../generated/properties/types.gen/type-aliases/PropertyTargetReference.md)

This entity's reference for bulk property operations.

#### Returns

[`PropertyTargetReference`](../../../../../generated/properties/types.gen/type-aliases/PropertyTargetReference.md)

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`propertyReference`](../../../entity/classes/PropertiedEntity.md#propertyreference)

***

### rename()

> **rename**(`name`): `Promise`\<`void`\>

Rename the document.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### restore()

> **restore**(): `Promise`\<`void`\>

Restore a soft-deleted document.

#### Returns

`Promise`\<`void`\>

***

### setProperty()

> **setProperty**(`property`, `value?`): `Promise`\<`void`\>

Set a property value on this entity, or attach the property without a
value when `value` is omitted.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `property` | [`PropertyDefinition`](../../../properties/property-definition/classes/PropertyDefinition.md) |
| `value?` | [`SetPropertyValue`](../../../../../generated/properties/types.gen/type-aliases/SetPropertyValue.md) |

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`setProperty`](../../../entity/classes/PropertiedEntity.md#setproperty)

***

### setTeamShare()

> **setTeamShare**(`shared`): `Promise`\<`void`\>

Share the document with the owner's team, or unshare it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `shared` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

### shortId()

> **shortId**(): `Promise`\<`string`\>

The document's short id (used in compact links and branch names).

#### Returns

`Promise`\<`string`\>

***

### teamShare()

> **teamShare**(): `Promise`\<[`DocumentTeamShareResponse`](../../../../../generated/storage/types.gen/type-aliases/DocumentTeamShareResponse.md)\>

Whether the document is shared with the owner's team, and which team.

#### Returns

`Promise`\<[`DocumentTeamShareResponse`](../../../../../generated/storage/types.gen/type-aliases/DocumentTeamShareResponse.md)\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`DocumentMetadataWithContent`](../../../../../generated/storage/types.gen/type-aliases/DocumentMetadataWithContent.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`DocumentMetadataWithContent`](../../../../../generated/storage/types.gen/type-aliases/DocumentMetadataWithContent.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`DocumentMetadataWithContent`](../../../../../generated/storage/types.gen/type-aliases/DocumentMetadataWithContent.md) |
| `id` | `string` |

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`toJSON`](../../../entity/classes/PropertiedEntity.md#tojson)

***

### toMention()

> **toMention**(): [`MentionPart`](../../../../mentions/interfaces/MentionPart.md)

#### Returns

[`MentionPart`](../../../../mentions/interfaces/MentionPart.md)

#### Implementation of

[`Mentionable`](../../../../mentions/interfaces/Mentionable.md).[`toMention`](../../../../mentions/interfaces/Mentionable.md#tomention)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`Document`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`Document`\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`unfavorite`](../../../entity/classes/PropertiedEntity.md#unfavorite)

***

### updatePropertyOptions()

> **updatePropertyOptions**(`changes`): `Promise`\<[`BulkUpdateEntityPropertyOptionsResponse`](../../../../../generated/properties/types.gen/type-aliases/BulkUpdateEntityPropertyOptionsResponse.md)\>

Apply multi-select option deltas atomically across this entity's properties.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `changes` | [`PropertyOptionDelta`](../../../entity/interfaces/PropertyOptionDelta.md)[] |

#### Returns

`Promise`\<[`BulkUpdateEntityPropertyOptionsResponse`](../../../../../generated/properties/types.gen/type-aliases/BulkUpdateEntityPropertyOptionsResponse.md)\>

#### Inherited from

[`PropertiedEntity`](../../../entity/classes/PropertiedEntity.md).[`updatePropertyOptions`](../../../entity/classes/PropertiedEntity.md#updatepropertyoptions)

***

### webUrl()

> **webUrl**(): `string`

The document's URL in the Macro web app.

#### Returns

`string`

***

### byId()

> `static` **byId**(`client`, `id`): `Document`

A handle to a document by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Document`

***

### create()

> `static` **create**(`client`, `opts`): `Promise`\<`Document`\>

Create a markdown document.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | \{ `markdown?`: `string`; `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); \} |
| `opts.markdown?` | `string` |
| `opts.name` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |

#### Returns

`Promise`\<`Document`\>

***

### createSkill()

> `static` **createSkill**(`client`, `opts`): `Promise`\<`Document`\>

Create a skill: a markdown document containing instructions that AI reads
and follows when the skill is referenced in an AI input.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | \{ `markdown?`: `string`; `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); \} |
| `opts.markdown?` | `string` |
| `opts.name` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |

#### Returns

`Promise`\<`Document`\>

***

### createSnippet()

> `static` **createSnippet**(`client`, `opts`): `Promise`\<`Document`\>

Create a snippet: a reusable markdown document that can be inserted into
any markdown area.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | \{ `markdown?`: `string`; `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); \} |
| `opts.markdown?` | `string` |
| `opts.name` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |

#### Returns

`Promise`\<`Document`\>

***

### recent()

> `static` **recent**(`client`, `opts?`): `AsyncGenerator`\<`Document`\>

The user's recent documents, most recent first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts?` | \{ `fileType?`: `string`; `pageSize?`: `number`; \} |
| `opts.fileType?` | `string` |
| `opts.pageSize?` | `number` |

#### Returns

`AsyncGenerator`\<`Document`\>

***

### recentlyDeleted()

> `static` **recentlyDeleted**(`client`): `Promise`\<`Document`[]\>

The user's recently soft-deleted documents. The underlying endpoint also
returns deleted chats and projects; those are filtered out here.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<`Document`[]\>
