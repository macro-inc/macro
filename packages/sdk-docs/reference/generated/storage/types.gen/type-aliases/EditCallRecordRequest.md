# Type Alias: EditCallRecordRequest

> **EditCallRecordRequest** = \{ `customName?`: `string` \| `null`; `sharePermission?`: `null` \| [`UpdateSharePermissionRequestV2`](UpdateSharePermissionRequestV2.md); `shareWithTeam?`: `boolean` \| `null`; \}

Edit call request, as supplied by inbound callers.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-customname"></a> `customName?` | `string` \| `null` | Updated user-supplied display name for the call. `None` is a no-op; `Some("")` clears `call_records.custom_name`; any other `Some(s)` overwrites it with `s`. Only the archived `call_records` row carries this column — patching while the call is still active is a no-op for this field. |
| <a id="property-sharepermission"></a> `sharePermission?` | `null` \| [`UpdateSharePermissionRequestV2`](UpdateSharePermissionRequestV2.md) | - |
| <a id="property-sharewithteam"></a> `shareWithTeam?` | `boolean` \| `null` | Deprecated alias for `sharePermission.teamShareAccessLevel`: `Some(true)` behaves like `"view"`, `Some(false)` like `null`, and `None` is a no-op. Supplying both with disagreeing values is rejected. The team is resolved from the call's `created_by`, not the acting user. |
