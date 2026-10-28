# Type Alias: ImportRun

> **ImportRun** = \{ `error?`: `string` \| `null`; `review_id?`: `string` \| `null`; `scanned?`: `null` \| [`ScanCounts`](ScanCounts.md); `source`: [`ImportSource`](ImportSource.md); `status`: [`RunStatus`](RunStatus.md); `updated_at`: `string`; \}

Discovery-run state for one user × source.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error?` | `string` \| `null` | Discovery failure detail, when the run failed. |
| <a id="property-review_id"></a> `review_id?` | `string` \| `null` | The review presenting the run's plan, once one does. A Notion plan is presented while it is still `running`; rows staged after that take it. |
| <a id="property-scanned"></a> `scanned?` | `null` \| [`ScanCounts`](ScanCounts.md) | - |
| <a id="property-source"></a> `source` | [`ImportSource`](ImportSource.md) | The source this run discovered from. |
| <a id="property-status"></a> `status` | [`RunStatus`](RunStatus.md) | Where the run is in its lifecycle. |
| <a id="property-updated_at"></a> `updated_at` | `string` | When the run state last changed. |
