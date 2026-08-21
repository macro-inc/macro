use super::*;
use crate::domain::model::{McpHeader, McpServer, McpTransport};

/// The MCP selection must serialize to the shape `POST /v1/agents` documents:
/// `name`, a `type` discriminator, `url`, and headers as an object.
#[test]
fn mcp_servers_serialize_to_the_documented_shape() {
    let server = McpServer {
        name: "docs".to_owned(),
        transport: McpTransport::Sse,
        url: "https://mcp.example.com/sse".to_owned(),
        headers: vec![McpHeader {
            name: "Authorization".to_owned(),
            value: "Bearer t".to_owned(),
        }],
    };

    assert_eq!(
        serde_json::to_value(McpServerSelection::from(&server)).expect("serializes"),
        serde_json::json!({
            "name": "docs",
            "type": "sse",
            "url": "https://mcp.example.com/sse",
            "headers": { "Authorization": "Bearer t" },
        })
    );
}

/// A server with no headers omits the key rather than sending an empty
/// object.
#[test]
fn headerless_mcp_servers_omit_the_key() {
    let server = McpServer {
        name: "plain".to_owned(),
        transport: McpTransport::Http,
        url: "https://mcp.example.com".to_owned(),
        headers: Vec::new(),
    };

    assert_eq!(
        serde_json::to_value(McpServerSelection::from(&server)).expect("serializes"),
        serde_json::json!({
            "name": "plain",
            "type": "http",
            "url": "https://mcp.example.com",
        })
    );
}

/// An agent created without MCP servers omits the field entirely, so Cursor's
/// own configuration is left alone rather than overridden with an empty list.
#[test]
fn no_mcp_servers_means_no_field() {
    let request = CreateAgentRequest {
        prompt: PromptBody {
            text: "hi".to_owned(),
        },
        repos: Vec::new(),
        model: None,
        mcp_servers: Vec::new(),
    };
    let body = serde_json::to_value(&request).expect("serializes");
    assert!(body.get("mcpServers").is_none(), "got {body}");
}
