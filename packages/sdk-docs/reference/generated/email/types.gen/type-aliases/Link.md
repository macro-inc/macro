# Type Alias: Link

> **Link** = \{ `calendar_disabled`: `boolean`; `created_at`: `string`; `email_address`: `string`; `fusionauth_user_id`: `string`; `has_calendar_data`: `boolean`; `id`: `string`; `is_primary`: `boolean`; `is_sync_active`: `boolean`; `macro_id`: `string`; `needs_calendar_permission`: `boolean`; `needs_reauth`: `boolean`; `photo_url?`: `string` \| `null`; `provider`: [`UserProvider`](UserProvider.md); `settings`: [`Settings`](Settings.md); `sync_status`: [`SyncStatus`](SyncStatus.md); `updated_at`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-calendar_disabled"></a> `calendar_disabled` | `boolean` | Whether the user turned calendar off for this inbox, which also removed its calendar data. `needs_calendar_permission` is true either way, so this is what separates "never granted" from "deliberately off" — unprompted calendar nags must stay quiet for the latter. |
| <a id="property-created_at"></a> `created_at` | `string` | - |
| <a id="property-email_address"></a> `email_address` | `string` | - |
| <a id="property-fusionauth_user_id"></a> `fusionauth_user_id` | `string` | - |
| <a id="property-has_calendar_data"></a> `has_calendar_data` | `boolean` | Whether Macro holds calendar data for this inbox. Drives the turn-off control on its own, so removing that data never depends on the recorded scopes still matching the set Macro requests today — a set that changes as the integration narrows, stranding data behind a capability check that no longer recognizes an older grant. |
| <a id="property-id"></a> `id` | `string` | - |
| <a id="property-is_primary"></a> `is_primary` | `boolean` | - |
| <a id="property-is_sync_active"></a> `is_sync_active` | `boolean` | - |
| <a id="property-macro_id"></a> `macro_id` | `string` | - |
| <a id="property-needs_calendar_permission"></a> `needs_calendar_permission` | `boolean` | Whether the link's Google grant is missing the calendar scope. True for inboxes connected before the calendar capability existed (and for grants where the user declined it); drives the per-inbox calendar upgrade prompt. Re-running the connect flow records the new grant. |
| <a id="property-needs_reauth"></a> `needs_reauth` | `boolean` | Whether the link's Google grant needs to be reconnected. Drives the per-inbox reconnect prompt independently of the sync-status badge. |
| <a id="property-photo_url"></a> `photo_url?` | `string` \| `null` | The inbox's own profile photo (its self-contact's SFS photo), if synced. |
| <a id="property-provider"></a> `provider` | [`UserProvider`](UserProvider.md) | - |
| <a id="property-settings"></a> `settings` | [`Settings`](Settings.md) | - |
| <a id="property-sync_status"></a> `sync_status` | [`SyncStatus`](SyncStatus.md) | - |
| <a id="property-updated_at"></a> `updated_at` | `string` | - |
