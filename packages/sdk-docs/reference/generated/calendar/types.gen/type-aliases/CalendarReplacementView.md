# Type Alias: CalendarReplacementView

> **CalendarReplacementView** = \{ `attendeeCount`: `number`; `completedSteps`: `number`; `event?`: `null` \| [`CalendarEvent`](CalendarEvent.md); `isSeries`: `boolean`; `operationId`: `string`; `providerUrl?`: `string` \| `null`; `removeConference`: `boolean`; `replacementUrl?`: `string` \| `null`; `status`: [`ReplacementStatus`](ReplacementStatus.md); `time`: [`EventTime`](EventTime.md); `title`: `string`; `totalSteps`: `number`; \}

Safe preview and recovery response; never exposes the opaque provider snapshot.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendeecount"></a> `attendeeCount` | `number` | Guest count for cancellation and reinvitation confirmation. |
| <a id="property-completedsteps"></a> `completedSteps` | `number` | Number of completed provider steps. |
| <a id="property-event"></a> `event?` | `null` \| [`CalendarEvent`](CalendarEvent.md) | - |
| <a id="property-isseries"></a> `isSeries` | `boolean` | Entire recurring series, including exceptions, is replaced. |
| <a id="property-operationid"></a> `operationId` | `string` | Use this identity when confirming or checking progress. |
| <a id="property-providerurl"></a> `providerUrl?` | `string` \| `null` | Original event for manual review. |
| <a id="property-removeconference"></a> `removeConference` | `boolean` | The provider conference is removed. |
| <a id="property-replacementurl"></a> `replacementUrl?` | `string` \| `null` | New provider event, when creation was confirmed. |
| <a id="property-status"></a> `status` | [`ReplacementStatus`](ReplacementStatus.md) | Current durable state. |
| <a id="property-time"></a> `time` | [`EventTime`](EventTime.md) | Frozen time. |
| <a id="property-title"></a> `title` | `string` | Frozen title. |
| <a id="property-totalsteps"></a> `totalSteps` | `number` | Number of provider steps in this operation. |
