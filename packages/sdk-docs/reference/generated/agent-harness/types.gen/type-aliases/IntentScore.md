# Type Alias: IntentScore

> **IntentScore** = \{ `intent`: [`InputIntent`](InputIntent.md); `score`: `number`; \}

Independent yes/no probabilities; these do not sum to one.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-intent"></a> `intent` | [`InputIntent`](InputIntent.md) | Destination evaluated by the classifier. |
| <a id="property-score"></a> `score` | `number` | Independent probability between zero and one. |
