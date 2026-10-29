# Type Alias: DatabaseDetail

> **DatabaseDetail** = \{ `database`: [`Database`](Database.md); `grant`: [`AccessLevel`](AccessLevel.md); `tables`: [`TableDetail`](TableDetail.md)[]; \}

Everything a client needs to render and edit one database: tables,
column placements with their definitions, and the SQL names the query
surface exposes them under.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-database"></a> `database` | [`Database`](Database.md) | The database. |
| <a id="property-grant"></a> `grant` | [`AccessLevel`](AccessLevel.md) | The viewer's access. |
| <a id="property-tables"></a> `tables` | [`TableDetail`](TableDetail.md)[] | Tables in tab order. |
