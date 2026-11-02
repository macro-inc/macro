# Type Alias: PipedreamRecoverRequest

> **PipedreamRecoverRequest** = \{ `app_slug`: `string`; `server_name?`: `string` \| `null`; \}

Request body for recovering a connect flow whose result the Connect UI
never reported.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-app_slug"></a> `app_slug` | `string` | The Pipedream app the flow was connecting, by name slug. |
| <a id="property-server_name"></a> `server_name?` | `string` \| `null` | Optional display name for the connector, as for completion. |
