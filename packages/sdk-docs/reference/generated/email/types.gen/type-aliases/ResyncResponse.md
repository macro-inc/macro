# Type Alias: ResyncResponse

> **ResyncResponse** = \{ `already_in_progress`: `boolean`; `backfill_job_id`: `string`; \}

The response returned from the resync endpoint.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-already_in_progress"></a> `already_in_progress` | `boolean` | True when a backfill was already running and this call was a no-op. |
| <a id="property-backfill_job_id"></a> `backfill_job_id` | `string` | The backfill job driving the (re-)sync. Either the freshly enqueued job or the one already in progress. |
