use super::*;
use crate::outbound::editing_worker_client::ReqwestEditingWorkerClient;
use wiremock::{Mock, MockServer, ResponseTemplate, matchers};

/// An editing worker whose `/markdown` endpoint answers every call with
/// `status` and the worker's wording for it.
async fn markdown_worker(status: u16, error: &str) -> MockServer {
    let worker = MockServer::start().await;
    Mock::given(matchers::method("POST"))
        .and(matchers::path("/markdown"))
        .respond_with(ResponseTemplate::new(status).set_body_json(json!({ "error": error })))
        .mount(&worker)
        .await;
    worker
}

fn markdown_router(worker: &MockServer) -> Router {
    let (mut state, documents, _, _) = test_state(NonUserOwners::Disabled);
    *documents.file_type.lock().unwrap() = Some(FileType::Md);
    state.editing_worker = Arc::new(ReqwestEditingWorkerClient::from_url(worker.uri()));
    router_for(state)
}

fn write_request() -> Request<Body> {
    with_jwt(
        Request::put(format!("/{RESOLVED_DOCUMENT_ID}/markdown"))
            .header("content-type", "application/json"),
    )
    .body(Body::from(
        json!({ "markdown": "# Plan\n\nShip the beta.", "expectedRevision": "AQID" }).to_string(),
    ))
    .unwrap()
}

fn read_request() -> Request<Body> {
    with_jwt(Request::get(format!("/{RESOLVED_DOCUMENT_ID}/markdown")))
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn documents_over_the_snapshot_limit_are_payload_too_large_not_bad_gateway() {
    let worker = markdown_worker(413, "The document exceeds the 4 MiB snapshot limit.").await;
    let router = markdown_router(&worker);

    let (write_status, write_body) = send(&router, write_request()).await;
    let (read_status, read_body) = send(&router, read_request()).await;

    assert_eq!(write_status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(write_body["error"], "document_too_large");
    assert_eq!(read_status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(read_body["error"], "document_too_large");
    let actions: Vec<Value> = worker
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|request| request.body_json::<Value>().unwrap()["request"]["action"].clone())
        .collect();
    assert_eq!(actions, vec![json!("write"), json!("read")]);
}

#[tokio::test]
async fn an_unavailable_worker_still_reports_an_unknown_write_outcome() {
    let worker = markdown_worker(502, "The sync service is unavailable. Please retry.").await;
    let router = markdown_router(&worker);

    let (status, body) = send(&router, write_request()).await;

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body["error"], "write_failed");
}
