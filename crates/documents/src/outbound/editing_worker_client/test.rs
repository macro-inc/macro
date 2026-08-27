use super::*;
use axum::{Json, Router, extract::State, http::HeaderMap, routing::post};
use serde_json::Value;
use tokio::sync::mpsc;

async fn capture_request(
    State(sender): State<mpsc::UnboundedSender<(HeaderMap, Value)>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Json<Value> {
    sender
        .send((headers, body))
        .expect("receiver should remain open");
    Json(serde_json::json!({ "ops": [], "usage": [] }))
}

#[tokio::test]
async fn edit_attribution_requires_an_internal_key() {
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let app = Router::new()
        .route("/edit", post(capture_request))
        .with_state(sender);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test listener should bind");
    let worker_url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let token = DocumentPermissionToken::from("document-token".to_string());

    ReqwestEditingWorkerClient::from_url(worker_url.clone())
        .edit("ai-edit:opaque", "document-id", &token, "instructions")
        .await
        .expect("unattributed edit should succeed");
    let (headers, body) = receiver.recv().await.expect("request should be captured");
    assert!(!headers.contains_key("x-internal-auth-key"));
    assert!(body.get("userId").is_none());

    ReqwestEditingWorkerClient::from_url(worker_url)
        .with_internal_auth_key(Some("internal-key".to_string()))
        .edit("ai-edit:opaque", "document-id", &token, "instructions")
        .await
        .expect("attributed edit should succeed");
    let (headers, body) = receiver.recv().await.expect("request should be captured");
    assert_eq!(headers["x-internal-auth-key"], "internal-key");
    assert_eq!(body["userId"], "ai-edit:opaque");

    server.abort();
}
