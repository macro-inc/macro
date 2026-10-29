# Type Alias: DecideSessionReviewData

> **DecideSessionReviewData** = \{ `body`: [`ReviewDecision`](ReviewDecision.md); `path`: \{ `review_id`: `string`; `session_id`: `string`; \}; `query?`: `never`; `url`: `"/agent-sessions/{session_id}/reviews/{review_id}"`; \}

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-body"></a> `body` | [`ReviewDecision`](ReviewDecision.md) |
| <a id="property-path"></a> `path` | \{ `review_id`: `string`; `session_id`: `string`; \} |
| `path.review_id` | `string` |
| `path.session_id` | `string` |
| <a id="property-query"></a> `query?` | `never` |
| <a id="property-url"></a> `url` | `"/agent-sessions/{session_id}/reviews/{review_id}"` |
