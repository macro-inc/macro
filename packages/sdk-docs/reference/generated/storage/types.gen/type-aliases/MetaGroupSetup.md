# Type Alias: MetaGroupSetup

> **MetaGroupSetup** = \{ `channel_id`: `string`; `connection_id`: `string`; `error_code?`: `string` \| `null`; `state`: [`MetaGroupSetupState`](MetaGroupSetupState.md); `subject`: `string`; \}

Public creation result; never contains a speculative remote group ID/link.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Native identity, reserved before provider I/O. |
| <a id="property-connection_id"></a> `connection_id` | `string` | Selected business connection. |
| <a id="property-error_code"></a> `error_code?` | `string` \| `null` | Sanitized diagnostic. |
| <a id="property-state"></a> `state` | [`MetaGroupSetupState`](MetaGroupSetupState.md) | Current creation outcome. |
| <a id="property-subject"></a> `subject` | `string` | Native owner's requested subject. |
