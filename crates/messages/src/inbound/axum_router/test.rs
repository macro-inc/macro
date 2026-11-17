use super::*;

#[tokio::test]
async fn contended_write_is_retryable_without_exposing_the_database_cause() {
    let response = MessageHttpError::from(MessageError::Contended(rootcause::report!(
        "private database detail"
    )))
    .into_response();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()[RETRY_AFTER], "1");
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"message": "conversation is busy; retry the request"})
    );
}

#[tokio::test]
async fn other_repository_failures_remain_internal_errors() {
    let response = MessageHttpError::from(MessageError::Repository(rootcause::report!(
        "private database detail"
    )))
    .into_response();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!response.headers().contains_key(RETRY_AFTER));
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"message": "message operation failed"})
    );
}

fn path(parent_type: &str, parent_id: &str) -> ParentPath {
    ParentPath {
        parent_type: parent_type.to_owned(),
        parent_id: parent_id.to_owned(),
        id: None,
        legacy_id: None,
    }
}

fn post(policy: &str) -> PostMessage {
    serde_json::from_value(serde_json::json!({
        "content": "nightly sync finished",
        "notification_policy": policy,
    }))
    .expect("post body")
}

#[test]
fn a_channel_message_may_be_silent() {
    let channel = path("channel", &Uuid::now_v7().to_string());

    assert!(ensure_policy_fits_parent(&channel, &post("Silent")).is_ok());
    assert!(ensure_policy_fits_parent(&channel, &post("MentionsOnly")).is_ok());
}

#[test]
fn other_parents_take_only_the_default_policy() {
    let document = path("document", &Uuid::now_v7().to_string());

    assert!(ensure_policy_fits_parent(&document, &post("Default")).is_ok());
    let refused = ensure_policy_fits_parent(&document, &post("Silent"))
        .expect_err("a silent document comment is refused");
    assert!(matches!(refused.0, MessageError::Invalid(_)));
}
