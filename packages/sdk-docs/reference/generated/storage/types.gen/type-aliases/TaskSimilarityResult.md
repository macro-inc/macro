# Type Alias: TaskSimilarityResult

> **TaskSimilarityResult** = \{ `taskId`: `string`; `taskName`: `string`; `vectorScore`: `number`; \}

A similar existing task computed for an unsaved draft, returned to the task
composer without persisting any embedding or match state.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-taskid"></a> `taskId` | `string` | The matching existing task. |
| <a id="property-taskname"></a> `taskName` | `string` | The matching task's display name. |
| <a id="property-vectorscore"></a> `vectorScore` | `number` | Cosine similarity from vector search. |
