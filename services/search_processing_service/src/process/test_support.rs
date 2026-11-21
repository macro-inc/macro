//! Helpers shared by the `process` tests.

/// Requests a fake recorded, as `METHOD path` and body.
pub(crate) type Requests = std::sync::Arc<std::sync::Mutex<Vec<(String, String)>>>;

/// Stands in for OpenSearch: records each request and answers deletes by
/// query as having deleted nothing, everything else as a successful write.
pub(crate) async fn fake_opensearch() -> (opensearch_client::OpensearchClient, Requests) {
    use axum::{
        Json,
        body::Bytes,
        http::{Method, Uri},
        response::IntoResponse,
    };

    let requests = Requests::default();
    let recorded = requests.clone();
    let app = axum::Router::new().fallback(move |method: Method, uri: Uri, body: Bytes| {
        let recorded = recorded.clone();
        async move {
            recorded.lock().unwrap().push((
                format!("{method} {}", uri.path()),
                String::from_utf8_lossy(&body).into_owned(),
            ));
            if uri.path().ends_with("/_delete_by_query") {
                Json(serde_json::json!({ "deleted": 0, "version_conflicts": 0, "failures": [] }))
                    .into_response()
            } else {
                Json(serde_json::json!({ "result": "created" })).into_response()
            }
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (
        opensearch_client::OpensearchClient::new(endpoint, String::new(), String::new()).unwrap(),
        requests,
    )
}
