use super::*;
use axum::{Router, http::StatusCode, response::IntoResponse, routing::get};
use http_body_util::Empty;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

fn get_request(url: &str) -> ProxyRequest {
    http::Request::get(url)
        .body(Empty::new().map_err(|never| match never {}).boxed_unsync())
        .unwrap()
}

/// Serve on loopback: `/` counts hits, `/away` redirects to `/`.
async fn serve(hits: Arc<AtomicUsize>) -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = Router::new()
        .route(
            "/",
            get(move || {
                hits.fetch_add(1, Ordering::SeqCst);
                async { "reached" }
            }),
        )
        .route(
            "/away",
            get(|| async { (StatusCode::TEMPORARY_REDIRECT, [("location", "/")]).into_response() }),
        );
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    port
}

#[tokio::test]
async fn internal_upstreams_are_refused_outside_local_development() {
    let hits = Arc::new(AtomicUsize::new(0));
    let port = serve(Arc::clone(&hits)).await;
    let forwarder = ReqwestForwarder::new(AddressPolicy::PublicOnly).unwrap();

    for url in [
        format!("http://127.0.0.1:{port}/"),
        format!("http://localhost:{port}/"),
    ] {
        assert!(forwarder.forward(get_request(&url)).await.is_err(), "{url}");
    }
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn redirects_go_back_to_the_caller() {
    let hits = Arc::new(AtomicUsize::new(0));
    let port = serve(Arc::clone(&hits)).await;
    let forwarder = ReqwestForwarder::new(AddressPolicy::AnyAddress).unwrap();

    let response = forwarder
        .forward(get_request(&format!("http://localhost:{port}/away")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(hits.load(Ordering::SeqCst), 0);

    let response = forwarder
        .forward(get_request(&format!("http://localhost:{port}/")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}
