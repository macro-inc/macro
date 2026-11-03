# Type Alias: PipedreamConnectCompleteRequest

> **PipedreamConnectCompleteRequest** = \{ `app_slug`: `string`; `server_name?`: `string` \| `null`; \}

Request body for recording a finished Macro Connect flow.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-app_slug"></a> `app_slug` | `string` | The app that was connected, by Pipedream slug. |
| <a id="property-server_name"></a> `server_name?` | `string` \| `null` | Optional display name for the connector, as for completion. |
