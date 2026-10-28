# Function: entitySearch()

> **entitySearch**\<`T`, `K`\>(`opts`): (`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`T`\>

Build a `search(client, query, opts?)` function for one entity type: unified
search hits narrowed to `type`, each mapped through `make`.
Most relevant first, auto-paginated.

## Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t"></a> `T` |
| <a id="type-parameter-k"></a> `K` *extends* `"email"` \| `"project"` \| `"chat"` \| `"channel"` \| `"document"` \| `"call"` \| `"company"` \| `"calendarEvent"` \| `"agentSession"` \| `"channelMessage"` |

## Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `opts` | \{ `filters?`: [`EntityFilters`](../../../../generated/search/types.gen/type-aliases/EntityFilters.md); `includeCrm?`: `boolean`; `make`: (`client`, `hit`) => `T`; `type`: `K`; \} | - |
| `opts.filters?` | [`EntityFilters`](../../../../generated/search/types.gen/type-aliases/EntityFilters.md) | - |
| `opts.includeCrm?` | `boolean` | Opt in to CRM results (off by default server-side; required for company hits). |
| `opts.make` | (`client`, `hit`) => `T` | - |
| `opts.type` | `K` | - |

## Returns

(`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`T`\>
