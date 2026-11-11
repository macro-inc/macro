//! `McpChatgptServiceUrl`: ChatGPT MCP server base URL (a Cloudflare Worker).

service_url::service_url! {
    /// ChatGPT MCP server base URL (a Cloudflare Worker). Append `/mcp` for
    /// its transport endpoint, which is also its RFC 8707 resource: the
    /// `McpPublicUrl` broker issues it Macro API tokens.
    pub struct McpChatgptServiceUrl {
        local: "http://localhost:8103",
        dev: "https://mcp-chatgpt.dev.macro.com",
        prod: "https://mcp-chatgpt.macro.com",
    }
}
