# Type Alias: TaskSimilaritySearchHandlerResponses

> **TaskSimilaritySearchHandlerResponses** = \{ `200`: \{ `results`: [`TaskSimilarityResult`](TaskSimilarityResult.md)[]; \}; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-200"></a> `200` | \{ `results`: [`TaskSimilarityResult`](TaskSimilarityResult.md)[]; \} | Response for searching tasks similar to an unsaved draft. |
| `200.results` | [`TaskSimilarityResult`](TaskSimilarityResult.md)[] | Existing tasks similar to the draft. |
