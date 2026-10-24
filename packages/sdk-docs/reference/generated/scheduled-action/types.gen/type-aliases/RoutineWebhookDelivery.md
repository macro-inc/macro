# Type Alias: RoutineWebhookDelivery

> **RoutineWebhookDelivery** = \{ `eventId`: `string`; `queued`: `boolean`; \}

What became of a delivery.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-eventid"></a> `eventId` | `string` | - |
| <a id="property-queued"></a> `queued` | `boolean` | Whether the routine will run for it. False when the routine is paused, has no webhook trigger, or its payload match left the delivery out. |
