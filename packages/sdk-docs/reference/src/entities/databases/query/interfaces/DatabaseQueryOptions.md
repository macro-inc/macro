# Interface: DatabaseQueryOptions

Scope and optimistic concurrency for one SQL statement.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-baseversions"></a> `baseVersions?` | [`QueryTableVersion`](QueryTableVersion.md)[] | Refuse writes if these tables changed since they were read. |
| <a id="property-database"></a> `database?` | [`Database`](../../database/classes/Database.md) | Default database for unqualified table names; visible databases remain joinable. |
