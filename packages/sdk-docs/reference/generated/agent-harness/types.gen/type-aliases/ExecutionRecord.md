# Type Alias: ExecutionRecord

> **ExecutionRecord** = \{ `actingAs?`: `null` \| [`ToolActor`](ToolActor.md); `activity?`: [`ExecutionActivity`](ExecutionActivity.md)[]; `activityTruncated?`: `boolean`; `calls`: [`RecordedToolCall`](RecordedToolCall.md)[]; `error?`: `string` \| `null`; `executionId`: [`ExecutionId`](ExecutionId.md); `result?`: `unknown`; `source`: `string`; `status`: [`ExecutionStatus`](ExecutionStatus.md); `turnId?`: `string` \| `null`; \}

Durable source and final outcome, with historical bridge calls when present.
The full journal is not included in the model's tool result.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actingas"></a> `actingAs?` | `null` \| [`ToolActor`](ToolActor.md) | - |
| <a id="property-activity"></a> `activity?` | [`ExecutionActivity`](ExecutionActivity.md)[] | Advisory SDK operation activity, without arguments or response contents. |
| <a id="property-activitytruncated"></a> `activityTruncated?` | `boolean` | Additional request activity was omitted at the bounded observation limit. |
| <a id="property-calls"></a> `calls` | [`RecordedToolCall`](RecordedToolCall.md)[] | Historical bridge calls. Direct HTTP executions leave this empty. |
| <a id="property-error"></a> `error?` | `string` \| `null` | Safe execution failure text. |
| <a id="property-executionid"></a> `executionId` | [`ExecutionId`](ExecutionId.md) | Execution identity. |
| <a id="property-result"></a> `result?` | `unknown` | JSON returned by the program, if successful. |
| <a id="property-source"></a> `source` | `string` | The submitted JavaScript module. |
| <a id="property-status"></a> `status` | [`ExecutionStatus`](ExecutionStatus.md) | Overall execution state. |
| <a id="property-turnid"></a> `turnId?` | `string` \| `null` | Original turn, preventing another requester from replaying a saved result. |
