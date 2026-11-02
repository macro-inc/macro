# Type Alias: TaskSimilaritySearchRequest

> **TaskSimilaritySearchRequest** = \{ `markdown?`: `string` \| `null`; `taskName`: `string`; \}

Request body for searching tasks similar to an unsaved draft.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-markdown"></a> `markdown?` | `string` \| `null` | Draft task body as embedding-format markdown. The composer produces it client-side with lexical-core's `markdownToEmbeddingText` (the same format lexical-service's `/markdown/{id}?target=embedding` renders), so this latency-sensitive endpoint embeds the text as-is without a lexical-service round trip. |
| <a id="property-taskname"></a> `taskName` | `string` | Draft task title. |
