use super::*;
use crate::outbound::editing_worker_client::ReqwestEditingWorkerClient;

/// An editing worker whose `/markdown` endpoint answers each call with the
/// next status in `statuses`, as the worker words a snapshot over 4 MiB or an
/// unavailable sync service.
async fn markdown_worker(statuses: Vec<u16>) -> (String, Arc<Mutex<Vec<Value>>>) {
    let received: Arc<Mutex<Vec<Value>>> = Arc::default();
    let statuses = Arc::new(Mutex::new(statuses.into_iter()));
    let sink = received.clone();
    let app = Router::new().route(
        "/markdown",
        axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
            let sink = sink.clone();
            let statuses = statuses.clone();
            async move {
                sink.lock().unwrap().push(body);
                let status = statuses.lock().unwrap().next().unwrap();
                let error = match status {
                    413 => "The document exceeds the 4 MiB snapshot limit.",
                    _ => "The sync service is unavailable. Please retry.",
                };
                (
                    StatusCode::from_u16(status).unwrap(),
                    axum::Json(json!({ "error": error })),
                )
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), received)
}

async fn markdown_router(statuses: Vec<u16>) -> (Router, Arc<Mutex<Vec<Value>>>) {
    let (url, received) = markdown_worker(statuses).await;
    let (mut state, documents, _, _) = test_state(NonUserOwners::Disabled);
    *documents.file_type.lock().unwrap() = Some(FileType::Md);
    state.editing_worker = Arc::new(ReqwestEditingWorkerClient::from_url(url));
    (router_for(state), received)
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
    let (router, received) = markdown_router(vec![413, 413]).await;

    let (write_status, write_body) = send(&router, write_request()).await;
    let (read_status, read_body) = send(&router, read_request()).await;

    assert_eq!(write_status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(write_body["error"], "document_too_large");
    assert_eq!(read_status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(read_body["error"], "document_too_large");
    let received = received.lock().unwrap();
    assert_eq!(received[0]["request"]["action"], "write");
    assert_eq!(received[1]["request"]["action"], "read");
}

#[tokio::test]
async fn an_unavailable_worker_still_reports_an_unknown_write_outcome() {
    let (router, _) = markdown_router(vec![502]).await;

    let (status, body) = send(&router, write_request()).await;

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body["error"], "write_failed");
}
