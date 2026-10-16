# Type Alias: StatusResponse

> **StatusResponse** = \{ `connected`: `boolean`; `enabled`: `boolean`; `ephemeral`: `boolean`; \}

Safe connection metadata.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-connected"></a> `connected` | `boolean` | Whether the authenticated Macro user has connected. |
| <a id="property-enabled"></a> `enabled` | `boolean` | Whether this deployment supports browser connection. |
| <a id="property-ephemeral"></a> `ephemeral` | `boolean` | Whether reconnecting after service restart is required. |
