use super::*;

#[test]
fn allows_localhost_and_subdomain_localhost_dev_ports() {
    for origin in [
        "http://localhost:3000",
        "http://localhost:3999",
        "http://localhost:20000",
        "http://alice.localhost:3000",
        "http://carol.localhost:3005",
    ] {
        assert!(is_allowed_origin(origin), "{origin}");
    }
}

#[test]
fn rejects_non_local_and_out_of_range_origins() {
    for origin in [
        "http://localhost:2999",
        "http://localhost:9000",
        "http://alice.localhost:9000",
        "https://alice.localhost:3000",
        "http://evil-localhost:3000",
        "http://alice.localhost.evil.com:3000",
        "http://example.com:3000",
    ] {
        assert!(!is_allowed_origin(origin), "{origin}");
    }
}

#[test]
fn allows_static_origins() {
    assert!(is_allowed_origin("https://macro.com"));
    assert!(is_allowed_origin("tauri://localhost"));
}

#[tokio::test]
async fn preflight_is_cacheable_for_two_hours() {
    use axum::{
        Router,
        body::Body,
        http::{Request, header},
        routing::post,
    };
    use tower::ServiceExt;

    let app = Router::new()
        .route("/items/soup/graphql", post(|| async {}))
        .layer(cors_layer());
    let preflight = Request::builder()
        .method(Method::OPTIONS)
        .uri("/items/soup/graphql")
        .header(header::ORIGIN, "https://macro.com")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(preflight).await.unwrap();

    assert_eq!(response.headers()[header::ACCESS_CONTROL_MAX_AGE], "7200");
}
