# Type Alias: RoutineRunFinishedMetadata

> **RoutineRunFinishedMetadata** = \{ `outcome`: [`RoutineRunOutcome`](RoutineRunOutcome.md); `routineId`: `string`; `routineName`: `string`; \}

One of the recipient's routines finished a run. Every run notifies,
whether it succeeded or failed.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-outcome"></a> `outcome` | [`RoutineRunOutcome`](RoutineRunOutcome.md) | How the run ended. |
| <a id="property-routineid"></a> `routineId` | `string` | The routine that ran. |
| <a id="property-routinename"></a> `routineName` | `string` | The routine's name when it ran. |
