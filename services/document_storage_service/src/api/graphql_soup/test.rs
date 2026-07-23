use axum::body::Body;

use super::*;

#[test]
fn detects_graphql_websocket_upgrade_requests() {
    let websocket = Request::builder()
        .header(header::UPGRADE, "websocket")
        .body(Body::empty())
        .expect("valid websocket request");
    let ordinary = Request::new(Body::empty());

    assert!(is_websocket_upgrade(&websocket));
    assert!(!is_websocket_upgrade(&ordinary));
}
