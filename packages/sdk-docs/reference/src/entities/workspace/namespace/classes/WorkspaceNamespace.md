# Class: WorkspaceNamespace

Browse recent workspace documents (including tasks), chats, projects, email,
channels, message threads, calls, calendar events and foreign entities.
Queries run with the caller's normal access permissions. Use search namespaces
to find specific names/content; use this namespace for activity and filtered lists.

Each item has an existing `entity` handle plus a generated API `snapshot` for
reading metadata without another request. Calendar snapshots contain event time
and conference details; calendar handles support operations, but cannot fetch
event details by ID. Use `snapshot.data` when the listing already has your data.

## Examples

**Important emails from a particular accessible inbox**

```js
const page = await macro.workspace.page({
  emailPreset: 'signal', inbox: 'team@example.com', limit: 20,
});
const evidence = page.items.map(item => ({
  id: item.id, ...item.type === 'email' ? {
    subject: item.subject, snippet: item.snippet, sender: item.senderEmail,
  } : {},
}));
// Report page.hasMore; this bounded page is not exhaustive.
```

**Tasks assigned to me, completed and updated within a time window**

```js
const owner = await macro.myPrincipalId();
const tasks = macro.workspace.list({
  includeTypes: ['document'],
  df: {'&': [{l: {dst: 'task'}}, {'&': [
    {l: {ua: {gte: '2026-10-14T00:00:00Z'}}},
    {l: {ua: {lt: '2026-10-15T00:00:00Z'}}},
  ]}]},
  propf: {'&': [
    {l: {pd: '00000001-0000-0000-0000-000000000002', et: 'TASK',
      v: {so: '00000001-0000-0000-0002-000000000004'}}},
    {l: {pd: '00000001-0000-0000-0000-000000000001', et: 'TASK',
      v: {er: owner}}},
  ]},
});
for await (const item of tasks) {
  if (item.type === 'document') console.log(item.id, item.name);
}
// updatedAt is not a completion timestamp; describe this scope accurately.
```

**Personal and team tags, favorites, and early stopping**

```js
let count = 0;
for await (const item of macro.workspace.list({
  favoritesOnly: true, sortBy: 'recently_viewed',
  tags: [{label: 'Launch', scope: 'team'}], tagsMatch: 'all',
})) {
  console.log(item.type, item.id, item.tags);
  if (++count === 10) break; // No subsequent page is fetched.
}
```

A single filter is `{l: {dst: 'task'}}`; `&` and `|` require exactly two
expressions, nested for larger combinations.
Advanced filters use the normal API AST. `df` accepts `dst` (task/skill/snippet),
`ft`, `id`, `pid`, and `ca`/`ua` timestamp bounds. `ef` supports `Sender`,
`Recipient`, `Read`, `ThreadId`, `ca`/`ua`/`va`; `chanf` supports `ChannelId`,
`Sender`, `IsParticipant`; `cthf` supports `ChannelId`/`ThreadId`; `callf`
supports `CallId`/`ChannelId`/`Speaker`/`Attended`. Filters remain server-validated.
CRM, agent sessions, initiatives and database rows have their own namespaces
and are not included in this browsing surface.

## Constructors

### Constructor

> **new WorkspaceNamespace**(`client`): `WorkspaceNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`WorkspaceNamespace`

## Methods

### list()

> **list**(`options?`): `AsyncGenerator`\<[`WorkspaceItem`](../../types/type-aliases/WorkspaceItem.md)\>

Lazy automatic pagination. `limit` is a page size, not a total result limit.
Break a `for await` loop to stop; no speculative next page is fetched.
Tag/inbox resolution is reused within this iterator.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | [`WorkspaceListOptions`](../../types/type-aliases/WorkspaceListOptions.md) |

#### Returns

`AsyncGenerator`\<[`WorkspaceItem`](../../types/type-aliases/WorkspaceItem.md)\>

***

### page()

> **page**(`options?`): `Promise`\<[`WorkspacePage`](../../types/type-aliases/WorkspacePage.md)\>

One bounded page. Resume using nextCursor and the same options.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | [`WorkspacePageOptions`](../../types/type-aliases/WorkspacePageOptions.md) |

#### Returns

`Promise`\<[`WorkspacePage`](../../types/type-aliases/WorkspacePage.md)\>
