//! `McpServiceUrl`: macro MCP service base URL. Append `/mcp` for its transport endpoint.

service_url::service_url! {
    /// Macro MCP service base URL. Append `/mcp` for its transport endpoint.
    pub struct McpServiceUrl {
        local: "http://localhost:8101",
        dev: "https://dev-gateway.macro.com/mcp",
        prod: "https://gateway.macro.com/mcp",
    }
}
