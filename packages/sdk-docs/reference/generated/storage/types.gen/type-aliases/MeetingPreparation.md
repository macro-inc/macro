# Type Alias: MeetingPreparation

> **MeetingPreparation** = \{ `expiresAt`: `string`; `id`: `string`; \}

An empty room reservation, not a started call or an invitation.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-expiresat"></a> `expiresAt` | `string` | After this deadline Start falls back to ordinary room creation. |
| <a id="property-id"></a> `id` | `string` | Also the reserved RTC room's UUID and prospective call ID. |
