//! The internal services the sync workers call besides SQS and the token
//! service (SFS, DSS, the connection gateway): each answers 200 `{}`.

use axum::Router;
use axum::http::StatusCode;
use axum::response::IntoResponse;

/// Serves the stand-in and returns its URL.
pub async fn start() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new().fallback(|| async {
        (StatusCode::OK, [("content-type", "application/json")], "{}").into_response()
    });
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}
