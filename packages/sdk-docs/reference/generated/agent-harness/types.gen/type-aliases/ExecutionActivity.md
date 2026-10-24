# Type Alias: ExecutionActivity

> **ExecutionActivity** = \{ `id`: `number`; `item?`: `null` \| [`ActivityItem`](ActivityItem.md); `label`: `string`; `status`: [`RecordedCallStatus`](RecordedCallStatus.md); \}

A bounded SDK operation observed during execution; not an authorization or write receipt.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `number` | Request identity within the execution. |
| <a id="property-item"></a> `item?` | `null` \| [`ActivityItem`](ActivityItem.md) | - |
| <a id="property-label"></a> `label` | `string` | Server-selected label from the generated operation catalog. |
| <a id="property-status"></a> `status` | [`RecordedCallStatus`](RecordedCallStatus.md) | Observed request state; unfinished operations have unknown outcomes. |
