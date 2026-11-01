# Type Alias: ClassifyInputResponse

> **ClassifyInputResponse** = \{ `revision`: `number`; `scores`: [`IntentScore`](IntentScore.md)[]; \}

Ranked-type evidence for a particular client draft revision.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-revision"></a> `revision` | `number` | Revision echoed from the classification request. |
| <a id="property-scores"></a> `scores` | [`IntentScore`](IntentScore.md)[] | Independent scores in the fixed intent-question order. |
