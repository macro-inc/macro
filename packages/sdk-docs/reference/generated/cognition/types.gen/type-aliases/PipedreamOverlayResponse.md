# Type Alias: PipedreamOverlayResponse

> **PipedreamOverlayResponse** = \{ `app_slug`: `string`; `server_url`: `string`; \}

A catalog app that connects through its own MCP server instead of
Pipedream.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-app_slug"></a> `app_slug` | `string` | Pipedream app name slug, as it appears in the catalog. |
| <a id="property-server_url"></a> `server_url` | `string` | The MCP server to authorize with the native MCP OAuth flow. |
