use super::*;
use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::{HttpHeader, McpServerHttp, McpServerSse};
use agent_runtime_protocol::domain::schema::v0::AcpMessage;

const TOKEN: &str = "placeholder-session-credential-123456";

fn tool_output(text: &str) -> ToServerMessage {
    ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::notification(
            "session/update".to_owned(),
            serde_json::json!({
                "sessionId": "session-placeholder",
                "update": {"sessionUpdate": "tool_call_update", "content": [{"type": "text", "text": text}]}
            }),
        )
        .expect("valid notification"),
    ))
}

fn http_server(value: &str) -> McpServer {
    McpServer::Http(
        McpServerHttp::new("example", "https://example.invalid/mcp")
            .headers(vec![HttpHeader::new("Authorization", value)]),
    )
}

#[test]
fn tool_output_scrubs_full_header_and_bare_bearer_token() {
    let original = tool_output(&format!("value: Bearer {TOKEN}; token: {TOKEN}; done"));
    let redacted =
        redact_inbound_credentials(original, &[http_server(&format!("Bearer {TOKEN}"))]).unwrap();
    assert_eq!(
        serde_json::to_value(redacted).unwrap(),
        serde_json::to_value(tool_output("value: [REDACTED]; token: [REDACTED]; done")).unwrap()
    );
}

#[test]
fn a_frame_without_a_secret_is_unchanged() {
    let original = tool_output("ordinary output");
    let redacted = redact_inbound_credentials(original.clone(), &[http_server(TOKEN)]).unwrap();
    assert_eq!(
        serde_json::to_value(redacted).unwrap(),
        serde_json::to_value(original).unwrap()
    );
}

#[test]
fn short_header_values_are_ignored() {
    let original = tool_output("a short value: tiny");
    let redacted = redact_inbound_credentials(original.clone(), &[http_server("tiny")]).unwrap();
    assert_eq!(
        serde_json::to_value(redacted).unwrap(),
        serde_json::to_value(original).unwrap()
    );
}

#[test]
fn sse_header_values_are_scrubbed() {
    let server = McpServer::Sse(
        McpServerSse::new("example", "https://example.invalid/sse")
            .headers(vec![HttpHeader::new("X-Token", TOKEN)]),
    );
    let redacted = redact_inbound_credentials(tool_output(TOKEN), &[server]).unwrap();
    assert_eq!(
        serde_json::to_value(redacted).unwrap(),
        serde_json::to_value(tool_output("[REDACTED]")).unwrap()
    );
}
