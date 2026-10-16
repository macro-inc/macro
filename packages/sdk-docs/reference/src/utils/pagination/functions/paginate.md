# Function: paginate()

> **paginate**\<`T`, `Cursor`\>(`fetchPage`): `AsyncGenerator`\<`T`\>

Async generator over a cursor-paginated API. Iterate with `for await`.
Cursors are plain JSON values (strings or small objects), so a page whose
next cursor serialises identically to the one it was fetched with means the
server is not advancing; the generator throws instead of looping forever.

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-t"></a> `T` | - |
| <a id="type-parameter-cursor"></a> `Cursor` | `string` |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `fetchPage` | (`cursor?`) => `Promise`\<[`Page`](../interfaces/Page.md)\<`T`, `Cursor`\>\> |

## Returns

`AsyncGenerator`\<`T`\>
