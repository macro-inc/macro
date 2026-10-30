# Type Alias: AgentMcpServer

> **AgentMcpServer** = \{ `app_slug`: `string`; `server_name`: `string`; \}

One Pipedream app an agent lists under [`AgentMcpServers::Selected`].

Only the catalog identity is stored. Whether a given person has connected
the app is theirs, resolved at call time by the egress proxy, never here.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-app_slug"></a> `app_slug` | `string` | Pipedream app slug, e.g. `linear`. |
| <a id="property-server_name"></a> `server_name` | `string` | Display name, e.g. `Linear`. |
