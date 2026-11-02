# Type Alias: ArchiveThreadsResponse

> **ArchiveThreadsResponse** = \{ `failed_thread_ids`: `string`[]; `updated_thread_ids`: `string`[]; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-failed_thread_ids"></a> `failed_thread_ids` | `string`[] | Threads left unchanged because they could not be updated. |
| <a id="property-updated_thread_ids"></a> `updated_thread_ids` | `string`[] | Threads whose archived status now matches the request. |
