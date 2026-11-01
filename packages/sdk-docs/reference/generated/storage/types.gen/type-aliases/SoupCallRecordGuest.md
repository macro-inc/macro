# Type Alias: SoupCallRecordGuest

> **SoupCallRecordGuest** = \{ `displayName`: `string`; `id`: `string`; `joinedAt`: `string`; `leftAt?`: `string` \| `null`; \}

A non-account guest of a call record, as displayed in Soup.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-displayname"></a> `displayName` | `string` | Guest-provided display name. |
| <a id="property-id"></a> `id` | `string` | Opaque guest identity; matches the guest's transcript speaker id. |
| <a id="property-joinedat"></a> `joinedAt` | `string` | When the guest joined the call. |
| <a id="property-leftat"></a> `leftAt?` | `string` \| `null` | When the guest left (None if still in an active call). |
