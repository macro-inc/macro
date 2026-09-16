use super::*;
use axum::{Json, Router, routing::post};

#[tokio::test]
async fn composition_preserves_lexical_output_without_tool_instructions() {
    let app = Router::new().route(
        "/agent-context",
        post(|| async { Json(serde_json::json!({ "markdown": "Sanitized prompt and context" })) }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let composer = LexicalAgentPromptComposer::new(LexicalClient::new(
        "test".into(),
        format!("http://{address}"),
    ));

    for messages in [None, Some([].as_slice())] {
        let prompt = composer.compose("Raw prompt", messages).await.unwrap();
        assert_eq!(prompt, "Sanitized prompt and context");
        assert!(!prompt.contains("set_pull_request"));
    }
    server.abort();
}
