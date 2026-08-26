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

/// The list response reads a documented page: items plus a `nextCursor` that
/// is absent — not null — on the last page.
#[test]
fn agent_pages_deserialize_with_and_without_a_next_cursor() {
    let page: ListAgentsResponse = serde_json::from_value(serde_json::json!({
        "items": [{
            "id": "bc-1",
            "name": "Add README",
            "status": "ACTIVE",
            "url": "https://cursor.com/agents/bc-1",
            "createdAt": "2026-04-13T18:30:00.000Z",
        }],
        "nextCursor": "bc-2",
    }))
    .expect("page with cursor");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].name, "Add README");
    assert_eq!(page.next_cursor.as_deref(), Some("bc-2"));

    let last: ListAgentsResponse =
        serde_json::from_value(serde_json::json!({ "items": [] })).expect("last page");
    assert!(last.next_cursor.is_none());
}

/// A service-account `GET /v1/me` body has no user fields; a user key's does.
/// Both must read.
#[test]
fn me_reads_user_and_service_account_shapes() {
    let user: MeResponse = serde_json::from_value(serde_json::json!({
        "apiKeyName": "wolf's key",
        "userId": 42,
        "createdAt": "2026-04-13T18:30:00.000Z",
        "userEmail": "wolf@macro.com",
    }))
    .expect("user key");
    assert_eq!(user.user_email.as_deref(), Some("wolf@macro.com"));

    let service: MeResponse = serde_json::from_value(serde_json::json!({
        "apiKeyName": "Production Service Account",
        "createdAt": "2026-04-13T18:30:00.000Z",
    }))
    .expect("service-account key");
    assert!(service.user_email.is_none());
}
