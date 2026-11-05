# Class: SavedViewsNamespace

Saved views: named filter definitions the app shows in a surface's sidebar,
such as Email. Each user orders the views they can see for themselves.

## Constructors

### Constructor

> **new SavedViewsNamespace**(`client`): `SavedViewsNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`SavedViewsNamespace`

## Methods

### byId()

> **byId**(`id`): [`SavedView`](../../saved-view/classes/SavedView.md)

A handle to a saved view by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`SavedView`](../../saved-view/classes/SavedView.md)

***

### create()

> **create**(`opts`): `Promise`\<[`SavedView`](../../saved-view/classes/SavedView.md)\>

Create a saved view; `config.kind` names the app surface that shows it.

An Email view (shown in Email's sidebar) has config
`{ kind: 'email', version: 1, filters }`, with every one of these filters:
`inboxIds` (inbox ids; empty for every inbox), `participants`
(`{ type: 'address', email }` or `{ type: 'domain', domain }`, any of
which matches), `participantFields` (which of `from`, `to`, `cc`, `bcc`
they match in), `subject` (words, any of which matches), `starred`,
`attachments` (`attachment-pdf`, `attachment-image`,
`attachment-document`), `calendarInvite`, and `tags` (`[]`); and
optionally `importance` (`signal` or `noise`), `read` (`unread` or
`read`), `done` (`not-done` or `done`) and `receivedWithinDays` (1, 7,
30 or 90). Separate filters must all match.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `opts` | \{ `config`: [`SavedViewConfig`](../../saved-view/type-aliases/SavedViewConfig.md); `name`: `string`; `team?`: [`Team`](../../../teams/team/classes/Team.md); \} | - |
| `opts.config` | [`SavedViewConfig`](../../saved-view/type-aliases/SavedViewConfig.md) | - |
| `opts.name` | `string` | - |
| `opts.team?` | [`Team`](../../../teams/team/classes/Team.md) | Share with this team, which you must belong to; private when omitted. |

#### Returns

`Promise`\<[`SavedView`](../../saved-view/classes/SavedView.md)\>

***

### list()

> **list**(`opts?`): `AsyncGenerator`\<[`SavedView`](../../saved-view/classes/SavedView.md)\>

The saved views you can see, in your own order, auto-paginated: placed
views first, then by creation time. Each handle already holds its record.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `opts?` | \{ `kind?`: `string`; \} | - |
| `opts.kind?` | `string` | Only views of this kind, such as `email`. |

#### Returns

`AsyncGenerator`\<[`SavedView`](../../saved-view/classes/SavedView.md)\>

***

### reorder()

> **reorder**(`kind`, `views`): `Promise`\<[`SavedView`](../../saved-view/classes/SavedView.md)[]\>

Set your own order of one kind's views: `views` first, in the order
given, and the rest after them by creation time. Returns the views in
their new order; their definitions are unchanged.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `kind` | `string` |
| `views` | [`SavedView`](../../saved-view/classes/SavedView.md)[] |

#### Returns

`Promise`\<[`SavedView`](../../saved-view/classes/SavedView.md)[]\>
