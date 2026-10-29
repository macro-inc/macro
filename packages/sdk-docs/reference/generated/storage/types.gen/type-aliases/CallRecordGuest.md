# Type Alias: CallRecordGuest

> **CallRecordGuest** = \{ `displayName`: `string`; `id`: [`GuestId`](GuestId.md); `joinedAt`: `string`; `leftAt?`: `string` \| `null`; \}

A non-account guest as returned in a [`CallRecord`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-displayname"></a> `displayName` | `string` | Guest-provided display name. |
| <a id="property-id"></a> `id` | [`GuestId`](GuestId.md) | Opaque guest identity; matches the guest's transcript `speaker_id`. |
| <a id="property-joinedat"></a> `joinedAt` | `string` | When the guest joined the call. |
| <a id="property-leftat"></a> `leftAt?` | `string` \| `null` | When the guest left (None if still in an active call). |
