use super::*;
use axum::{Json, Router, http::HeaderMap, routing::get};
use std::sync::Arc;

#[tokio::test]
async fn live_source_preserves_the_hosts_resolved_credential() {
    let config: RawDocumentConfig = serde_json::from_value(serde_json::json!({
        "SYNC_SERVICE_AUTH_KEY":"resolved-test-credential",
    }))
    .unwrap();
    let app = Router::new().route("/document/document-test/raw", get(|headers: HeaderMap| async move {
        assert_eq!(headers.get("x-internal-auth-key").unwrap(), "resolved-test-credential");
        Json(serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"Hello"}]}]}}))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (shutdown, stop) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stop.await;
            })
            .await
            .unwrap();
    });
    let source = SyncServiceClient::new(config.sync_service_auth_key, format!("http://{address}"));
    let client = crate::LexicalClient::new("test-key".into(), "http://127.0.0.1:1".into())
        .with_route_modes("markdown=in_process".parse().unwrap())
        .with_document_source(Arc::new(source));
    assert_eq!(
        client
            .get_markdown(
                "document-test",
                crate::parse_markdown::MarkdownTarget::Internal
            )
            .await
            .unwrap(),
        "Hello"
    );
    shutdown.send(()).unwrap();
    server.await.unwrap();
}
