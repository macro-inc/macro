# Type Alias: AgentMcpServers

> **AgentMcpServers** = \{ `scope`: `"owner_connections"`; \} \| \{ `scope`: `"selected"`; `servers`: [`AgentMcpServer`](AgentMcpServer.md)[]; \}

Which Pipedream MCP servers an agent's sessions are handed.

One value for the whole choice, so a selection can never travel without
its scope or a scope without its selection. Serialized with a `scope` tag,
which the generated TypeScript sees as a discriminated union.

## Union Members

### Type Literal

\{ `scope`: `"owner_connections"`; \}

***

### Type Literal

\{ `scope`: `"selected"`; `servers`: [`AgentMcpServer`](AgentMcpServer.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `scope` | `"selected"` | - |
| `servers` | [`AgentMcpServer`](AgentMcpServer.md)[] | The apps, in the order the agent's author picked them. |
