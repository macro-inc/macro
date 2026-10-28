# Type Alias: AppliedOps

> **AppliedOps** = \{ `changes`: [`CommittedChange`](CommittedChange.md)[]; `results`: [`OpResult`](OpResult.md)[]; \}

What a committed batch answers: a result per op, and the journal's change
for each table version it produced.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changes"></a> `changes` | [`CommittedChange`](CommittedChange.md)[] | The journal's changes. |
| <a id="property-results"></a> `results` | [`OpResult`](OpResult.md)[] | One result per op, in order. |
