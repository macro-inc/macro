# Class: DatabaseNamespace

Macro databases: named collections of tables, owned and shared as one
entity.

A table the user names can be a tab inside a database with another name,
so look through every database's tables before saying it does not exist.
Person columns hold user ids, never names: find people in `macro.people`,
then write their ids. Select the rows a write means first, then change
exactly those by `row_id`, and read them back before saying it worked.

```js
const databases = await macro.databases.list();
const matches = await Promise.all(
  databases.map(async (database) => ({ database, table: await database.table('Tickets') })),
);
const { database } = matches.find((match) => match.table);
const people = await database.query(
  `SELECT id FROM macro.people WHERE email = 'sam@example.com'`,
);
const sam = people.result?.rows[0]?.[0]?.value;
const open = await database.query(`SELECT row_id FROM "Tickets" WHERE "Status" = 'Open'`);
const ids = open.result?.rowHandles.map((row) => `'${row.id}'`).join(', ');
await database.query(`UPDATE "Tickets" SET "Owner" = '${sam}' WHERE row_id IN (${ids})`);
```

## Constructors

### Constructor

> **new DatabaseNamespace**(`client`): `DatabaseNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`DatabaseNamespace`

## Methods

### byId()

> **byId**(`id`): [`Database`](../../database/classes/Database.md)

A handle to a database by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Database`](../../database/classes/Database.md)

***

### create()

> **create**(`options`): `Promise`\<[`Database`](../../database/classes/Database.md)\>

Create a database owned by the caller.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `name`: `string`; \} |
| `options.name` | `string` |

#### Returns

`Promise`\<[`Database`](../../database/classes/Database.md)\>

***

### list()

> **list**(): `Promise`\<[`Database`](../../database/classes/Database.md)[]\>

The databases the caller can see.

#### Returns

`Promise`\<[`Database`](../../database/classes/Database.md)[]\>

***

### query()

> **query**(`sql`, `options?`): `Promise`\<[`DatabaseQueryResult`](../../query/interfaces/DatabaseQueryResult.md)\>

Run one SQL statement over the caller's visible databases. Writes execute once.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sql` | `string` |
| `options?` | [`DatabaseQueryOptions`](../../query/interfaces/DatabaseQueryOptions.md) |

#### Returns

`Promise`\<[`DatabaseQueryResult`](../../query/interfaces/DatabaseQueryResult.md)\>
