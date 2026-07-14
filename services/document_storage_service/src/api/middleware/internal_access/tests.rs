use axum::Router;
use axum::body::Body;
use axum::routing::get;
use http_body_util::BodyExt;
use tower::ServiceExt;

use super::*;

fn make_app() -> Router {
    Router::new().route("/", get(async || "hello world")).layer(
        axum::middleware::from_fn_with_state(
            DocumentStorageServiceAuthKey::Comptime("my-secret-value"),
            handler,
        ),
    )
}

#[tokio::test]
async fn it_catches_missing_header() {
    let res = make_app()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    // we didn't provide the header value
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.into()).unwrap();
    assert_eq!(text, InternalAccessErr::MissingHeader.to_string());
}

#[tokio::test]
async fn it_catches_non_ascii() {
    let header = "🦀🦀🦀🦀🦀🦀🦀🦀";
    let res = make_app()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.into()).unwrap();
    assert!(text.contains("Failed to parse"))
}

#[tokio::test]
async fn it_fails_with_invalid_header() {
    let header = "wrong_header";
    let res = make_app()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.into()).unwrap();
    assert_eq!(
        text,
        InternalAccessErr::InvalidHeaderValue(header.to_string()).to_string()
    );
}

#[tokio::test]
async fn it_works_with_correct_header() {
    let header = "my-secret-value";
    let res = make_app()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.into()).unwrap();
    assert_eq!(text, "hello world");
}
