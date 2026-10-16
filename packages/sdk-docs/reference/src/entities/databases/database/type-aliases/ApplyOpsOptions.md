# Type Alias: ApplyOpsOptions

> **ApplyOpsOptions** = \{ `baseVersions?`: \{ `table`: [`DatabaseTable`](../../table/classes/DatabaseTable.md); `version`: [`TableVersion`](../../../../../generated/storage/types.gen/type-aliases/TableVersion.md); \}[]; \}

Options for [Database.applyOps](../classes/Database.md#applyops).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-baseversions"></a> `baseVersions?` | \{ `table`: [`DatabaseTable`](../../table/classes/DatabaseTable.md); `version`: [`TableVersion`](../../../../../generated/storage/types.gen/type-aliases/TableVersion.md); \}[] | The version each table must still be at, as the caller read it. A table that moved refuses the whole batch with a 409, so an edit made against what the caller saw does not overwrite another's. |
