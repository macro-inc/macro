# Type Alias: ImportState

> **ImportState** = \{ `entities`: [`ImportEntity`](ImportEntity.md)[]; `runs`: [`ImportRun`](ImportRun.md)[]; \}

The full import aggregate for a user: discovery runs plus visible ledger
rows (their own, and teammates' team-imported rows).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-entities"></a> `entities` | [`ImportEntity`](ImportEntity.md)[] | Visible import entities, newest first. |
| <a id="property-runs"></a> `runs` | [`ImportRun`](ImportRun.md)[] | Discovery runs, one per source that ever ran discovery. |
