# Type Alias: CreateMeetingRequest

> **CreateMeetingRequest** = \{ `preparationId?`: `string` \| `null`; `scheduledEnd?`: `string` \| `null`; `scheduledStart?`: `string` \| `null`; `title?`: `string` \| `null`; \}

Inputs for creating a meeting without starting its RTC room.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-preparationid"></a> `preparationId?` | `string` \| `null` | Optional unused room reserved by this actor on the setup screen. |
| <a id="property-scheduledend"></a> `scheduledEnd?` | `string` \| `null` | Optional scheduled end. |
| <a id="property-scheduledstart"></a> `scheduledStart?` | `string` \| `null` | Optional scheduled start. |
| <a id="property-title"></a> `title?` | `string` \| `null` | Optional display title. |
