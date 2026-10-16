# Type Alias: ServerResponse

> **ServerResponse** = \{ `authenticated`: `boolean`; `enabled`: `boolean`; `server_name`: `string`; `url`: `string`; \}

An MCP server record as returned by the API.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-authenticated"></a> `authenticated` | `boolean` | Whether the server has valid stored credentials. |
| <a id="property-enabled"></a> `enabled` | `boolean` | Whether the server is enabled for tool use. |
| <a id="property-server_name"></a> `server_name` | `string` | Human-readable server name. |
| <a id="property-url"></a> `url` | `string` | The MCP server URL. |
