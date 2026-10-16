# Class: Task

A Macro task: a document with sub-type `task`. Inherits the full document
surface ([Document.rename](../../../documents/document/classes/Document.md#rename), move, delete, restore, content, events)
and adds task-specific state.

## Extends

- [`Document`](../../../documents/document/classes/Document.md)

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-branchedfrom"></a> `branchedFrom` | `readonly` | () => `Promise`\<[`Document`](../../../documents/document/classes/Document.md) \| `undefined`\> | `...` | The document this one was branched from, if any. | - | [`Document`](../../../documents/document/classes/Document.md).[`branchedFrom`](../../../documents/document/classes/Document.md#property-branchedfrom) |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the document was created. | - | [`Document`](../../../documents/document/classes/Document.md).[`createdAt`](../../../documents/document/classes/Document.md#property-createdat) |
| <a id="property-deletedat"></a> `deletedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the document was deleted, if it has been. | - | [`Document`](../../../documents/document/classes/Document.md).[`deletedAt`](../../../documents/document/classes/Document.md#property-deletedat) |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"document"` | `'document'` | Favorites identify documents as `document`. | - | [`Document`](../../../documents/document/classes/Document.md).[`entityType`](../../../documents/document/classes/Document.md#property-entitytype) |
| <a id="property-filetype"></a> `fileType` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | The document's file type (e.g. `md`, `pdf`, `docx`). | - | [`Document`](../../../documents/document/classes/Document.md).[`fileType`](../../../documents/document/classes/Document.md#property-filetype) |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`Document`](../../../documents/document/classes/Document.md).[`id`](../../../documents/document/classes/Document.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | `...` | The document's display name. | - | [`Document`](../../../documents/document/classes/Document.md).[`name`](../../../documents/document/classes/Document.md#property-name) |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | `...` | The user who owns the document. | - | [`Document`](../../../documents/document/classes/Document.md).[`owner`](../../../documents/document/classes/Document.md#property-owner) |
| <a id="property-project"></a> `project` | `readonly` | () => `Promise`\<[`Project`](../../../projects/project/classes/Project.md) \| `undefined`\> | `...` | The project this document belongs to, if any. | - | [`Document`](../../../documents/document/classes/Document.md).[`project`](../../../documents/document/classes/Document.md#property-project) |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the document was last updated. | - | [`Document`](../../../documents/document/classes/Document.md).[`updatedAt`](../../../documents/document/classes/Document.md#property-updatedat) |
| <a id="property-search"></a> `search` | `static` | (`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`Task`\> | `...` | Search tasks by name and content, most relevant first, auto-paginated. | [`Document`](../../../documents/document/classes/Document.md).[`search`](../../../documents/document/classes/Document.md#property-search) | - |

## Methods

### branchName()

> **branchName**(): `Promise`\<`string`\>

The git branch name derived for the document (task documents).

#### Returns

`Promise`\<`string`\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`branchName`](../../../documents/document/classes/Document.md#branchname)

***

### comment()

> **comment**(`body`, `opts?`): `Promise`\<[`Comment`](../../../documents/comment/classes/Comment.md)\>

Add a comment. Starts a new unanchored thread, or replies to an existing
one when `threadId` (the thread's root comment id) is given.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) | Plain text, or a rich body composed with msg. |
| `opts?` | \{ `threadId?`: `string`; \} | - |
| `opts.threadId?` | `string` | - |

#### Returns

`Promise`\<[`Comment`](../../../documents/comment/classes/Comment.md)\>

The created comment.

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`comment`](../../../documents/document/classes/Document.md#comment)

***

### comments()

> **comments**(): `Promise`\<[`CommentThread`](../../../documents/document/interfaces/CommentThread.md)[]\>

The document's live comment threads, each with its comments, newest thread first.

#### Returns

`Promise`\<[`CommentThread`](../../../documents/document/interfaces/CommentThread.md)[]\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`comments`](../../../documents/document/classes/Document.md#comments)

***

### completed()

> **completed**(): `Promise`\<`boolean` \| `undefined`\>

Whether the task is completed (its Status property is "Completed");
`undefined` if the document is not a task.

#### Returns

`Promise`\<`boolean` \| `undefined`\>

***

### content()

> **content**(): `Promise`\<`string`\>

Current Markdown for native documents, extracted text for PDF/Word,
or raw file content for other formats. Native reads include live edits.

#### Returns

`Promise`\<`string`\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`content`](../../../documents/document/classes/Document.md#content)

***

### copy()

> **copy**(`opts`): `Promise`\<[`Document`](../../../documents/document/classes/Document.md)\>

Copy the document under a new name, optionally from a specific version.
Returns a handle to the new document.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `name`: `string`; `versionId?`: `number`; \} |
| `opts.name` | `string` |
| `opts.versionId?` | `number` |

#### Returns

`Promise`\<[`Document`](../../../documents/document/classes/Document.md)\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`copy`](../../../documents/document/classes/Document.md#copy)

***

### delete()

> **delete**(`opts?`): `Promise`\<`void`\>

Delete the document. Soft by default (reversible with [restore](../../../documents/document/classes/Document.md#restore));
pass `permanent: true` to delete irreversibly.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `permanent?`: `boolean`; \} |
| `opts.permanent?` | `boolean` |

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`delete`](../../../documents/document/classes/Document.md#delete)

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

[`Document`](../../../documents/document/classes/Document.md).[`deleteProperty`](../../../documents/document/classes/Document.md#deleteproperty)

***

### favorite()

> **favorite**(): `Promise`\<`Task`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`Task`\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`favorite`](../../../documents/document/classes/Document.md#favorite)

***

### githubPullRequests()

> **githubPullRequests**(): `Promise`\<[`GithubPullRequest`](../../../../../generated/storage/types.gen/type-aliases/GithubPullRequest.md)[]\>

GitHub pull requests associated with the document.

#### Returns

`Promise`\<[`GithubPullRequest`](../../../../../generated/storage/types.gen/type-aliases/GithubPullRequest.md)[]\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`githubPullRequests`](../../../documents/document/classes/Document.md#githubpullrequests)

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

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`move`](../../../documents/document/classes/Document.md#move)

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

[`Document`](../../../documents/document/classes/Document.md).[`properties`](../../../documents/document/classes/Document.md#properties)

***

### propertyReference()

> **propertyReference**(): [`PropertyTargetReference`](../../../../../generated/properties/types.gen/type-aliases/PropertyTargetReference.md)

This entity's reference for bulk property operations.

#### Returns

[`PropertyTargetReference`](../../../../../generated/properties/types.gen/type-aliases/PropertyTargetReference.md)

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`propertyReference`](../../../documents/document/classes/Document.md#propertyreference)

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

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`rename`](../../../documents/document/classes/Document.md#rename)

***

### restore()

> **restore**(): `Promise`\<`void`\>

Restore a soft-deleted document.

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`restore`](../../../documents/document/classes/Document.md#restore)

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

[`Document`](../../../documents/document/classes/Document.md).[`setProperty`](../../../documents/document/classes/Document.md#setproperty)

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

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`setTeamShare`](../../../documents/document/classes/Document.md#setteamshare)

***

### shortId()

> **shortId**(): `Promise`\<`string`\>

The document's short id (used in compact links and branch names).

#### Returns

`Promise`\<`string`\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`shortId`](../../../documents/document/classes/Document.md#shortid)

***

### teamShare()

> **teamShare**(): `Promise`\<[`DocumentTeamShareResponse`](../../../../../generated/storage/types.gen/type-aliases/DocumentTeamShareResponse.md)\>

Whether the document is shared with the owner's team, and which team.

#### Returns

`Promise`\<[`DocumentTeamShareResponse`](../../../../../generated/storage/types.gen/type-aliases/DocumentTeamShareResponse.md)\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`teamShare`](../../../documents/document/classes/Document.md#teamshare)

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

[`Document`](../../../documents/document/classes/Document.md).[`toJSON`](../../../documents/document/classes/Document.md#tojson)

***

### toMention()

> **toMention**(): [`MentionPart`](../../../../mentions/interfaces/MentionPart.md)

#### Returns

[`MentionPart`](../../../../mentions/interfaces/MentionPart.md)

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`toMention`](../../../documents/document/classes/Document.md#tomention)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`Task`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`Task`\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`unfavorite`](../../../documents/document/classes/Document.md#unfavorite)

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

[`Document`](../../../documents/document/classes/Document.md).[`updatePropertyOptions`](../../../documents/document/classes/Document.md#updatepropertyoptions)

***

### webUrl()

> **webUrl**(): `string`

The task's URL in the Macro web app.

#### Returns

`string`

#### Overrides

[`Document`](../../../documents/document/classes/Document.md).[`webUrl`](../../../documents/document/classes/Document.md#weburl)

***

### byId()

> `static` **byId**(`client`, `id`): `Task`

A handle to a task by document id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Task`

#### Overrides

[`Document`](../../../documents/document/classes/Document.md).[`byId`](../../../documents/document/classes/Document.md#byid)

***

### create()

> `static` **create**(`client`, `opts`): `Promise`\<`Task`\>

Create a task. `team` scopes the team task number and may be omitted
when the creator belongs to exactly one team; `shareWithTeam` defaults
to true.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | \{ `markdown?`: `string`; `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); `shareWithTeam?`: `boolean`; `team?`: [`Team`](../../../teams/team/classes/Team.md); \} |
| `opts.markdown?` | `string` |
| `opts.name` | `string` |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) |
| `opts.shareWithTeam?` | `boolean` |
| `opts.team?` | [`Team`](../../../teams/team/classes/Team.md) |

#### Returns

`Promise`\<`Task`\>

#### Overrides

[`Document`](../../../documents/document/classes/Document.md).[`create`](../../../documents/document/classes/Document.md#create)

***

### createSkill()

> `static` **createSkill**(`client`, `opts`): `Promise`\<[`Document`](../../../documents/document/classes/Document.md)\>

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

`Promise`\<[`Document`](../../../documents/document/classes/Document.md)\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`createSkill`](../../../documents/document/classes/Document.md#createskill)

***

### createSnippet()

> `static` **createSnippet**(`client`, `opts`): `Promise`\<[`Document`](../../../documents/document/classes/Document.md)\>

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

`Promise`\<[`Document`](../../../documents/document/classes/Document.md)\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`createSnippet`](../../../documents/document/classes/Document.md#createsnippet)

***

### forPullRequest()

> `static` **forPullRequest**(`client`, `url`): `Promise`\<`Task`[]\>

The tasks the GitHub pull request at `url` references (as `MACRO-<id>` in
its text, branch, or comments), oldest link first. Empty when the caller
cannot see the pull request; tasks the caller cannot open still appear.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `url` | `string` |

#### Returns

`Promise`\<`Task`[]\>

***

### recent()

> `static` **recent**(`client`, `opts?`): `AsyncGenerator`\<[`Document`](../../../documents/document/classes/Document.md)\>

The user's recent documents, most recent first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts?` | \{ `fileType?`: `string`; `pageSize?`: `number`; \} |
| `opts.fileType?` | `string` |
| `opts.pageSize?` | `number` |

#### Returns

`AsyncGenerator`\<[`Document`](../../../documents/document/classes/Document.md)\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`recent`](../../../documents/document/classes/Document.md#recent)

***

### recentlyDeleted()

> `static` **recentlyDeleted**(`client`): `Promise`\<[`Document`](../../../documents/document/classes/Document.md)[]\>

The user's recently soft-deleted documents. The underlying endpoint also
returns deleted chats and projects; those are filtered out here.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<[`Document`](../../../documents/document/classes/Document.md)[]\>

#### Inherited from

[`Document`](../../../documents/document/classes/Document.md).[`recentlyDeleted`](../../../documents/document/classes/Document.md#recentlydeleted)
