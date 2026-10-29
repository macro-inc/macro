# Type Alias: PipedreamCompleteRequest

> **PipedreamCompleteRequest** = \{ `account_id`: `string`; `server_name?`: `string` \| `null`; \}

Request body for completing a Pipedream connect flow.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-account_id"></a> `account_id` | `string` | The connected-account ID reported by the Connect UI on success. |
| <a id="property-server_name"></a> `server_name?` | `string` \| `null` | Optional display name for the connector. Defaults to the app's name for new connections; existing connections keep their name. |
