# Type Alias: ApplyOpsResponse

> **ApplyOpsResponse** = \{ `changes`: [`CommittedChange`](CommittedChange.md)[]; `results`: [`OpResult`](OpResult.md)[]; \}

What each op of a batch did.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changes"></a> `changes` | [`CommittedChange`](CommittedChange.md)[] | The journal's change for each table version the batch produced: the ids `POST /databases/{id}/changes/{change}/undo` takes. |
| <a id="property-results"></a> `results` | [`OpResult`](OpResult.md)[] | One result per op, in the order the ops were sent. Each is grouped as its op is: the same outer `kind`, naming the same ids, with a `change` saying what happened. |
