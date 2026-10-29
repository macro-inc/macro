# Type Alias: ActiveCallSummary

> **ActiveCallSummary** = \{ `callId`: `string`; `channelId`: `string`; `createdAt`: `string`; `createdBy`: `string`; `participantCount`: `number`; \}

A currently active call, as returned by the batch active-calls listing.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-callid"></a> `callId` | `string` | The call identifier. |
| <a id="property-channelid"></a> `channelId` | `string` | The channel this call belongs to. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the call was created. |
| <a id="property-createdby"></a> `createdBy` | `string` | User who created the call. |
| <a id="property-participantcount"></a> `participantCount` | `number` | Number of active participants. Always >= 1 — calls with no active participants (e.g. orphaned by a dropped RTC webhook) are excluded. |
