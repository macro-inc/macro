//! `McpPublicUrl`: public MCP OAuth issuer and callback base, distinct from gateway transport routing.

service_url::service_url! {
    /// Public MCP OAuth issuer and callback base, distinct from gateway transport routing.
    pub struct McpPublicUrl {
        local: "http://localhost:8101",
        dev: "https://mcp-server-dev.macro.com",
        prod: "https://mcp-server.macro.com",
    }
}
