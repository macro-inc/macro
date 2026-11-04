# Interface: SimilarTask

An existing task that looks like the same work as a proposed one.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | The existing task's name. |
| <a id="property-similarity"></a> `similarity` | `number` | Cosine similarity of the two tasks' embeddings, from 0 to 1. |
| <a id="property-task"></a> `task` | [`Task`](../classes/Task.md) | The existing task. |
