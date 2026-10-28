use super::{health, mount_at_root_and_prefix};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

#[test]
fn channel_backfill_wire_scope_distinguishes_missing_null_empty_and_explicit() {
    use crate::domain::models::{ChannelBackfillRequest, DeletionFilter};
    for json in ["{}", r#"{"channel_ids":null}"#] {
        let request: ChannelBackfillRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.channel_ids, None);
    }
    let empty: ChannelBackfillRequest = serde_json::from_str(r#"{"channel_ids":[]}"#).unwrap();
    assert_eq!(empty.channel_ids, Some(vec![]));
    let id = uuid::Uuid::now_v7();
    let request: ChannelBackfillRequest = serde_json::from_value(serde_json::json!({
        "channel_ids": [id], "deletion_filter": "active", "index_override": "channels_repair"
    }))
    .unwrap();
    assert_eq!(request.channel_ids, Some(vec![id]));
    assert_eq!(request.deletion_filter, DeletionFilter::Active);
    assert_eq!(request.index_override.as_deref(), Some("channels_repair"));
    assert!(
        serde_json::from_str::<ChannelBackfillRequest>(r#"{"channel_ids":["invalid"]}"#).is_err()
    );
}

#[tokio::test]
async fn health_is_reachable_at_root_and_gateway_prefix() {
    for path in ["/health", "/search-processing/health"] {
        let response = mount_at_root_and_prefix(health::router())
            .oneshot(
                Request::builder()
                    .uri(path)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    let response = mount_at_root_and_prefix(health::router())
        .oneshot(
            Request::builder()
                .uri("/missing")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
