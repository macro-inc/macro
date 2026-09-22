use super::*;

#[tokio::test]
async fn sync_notifications_require_internal_auth_and_forward_only_identity_and_attribution() {
    let (router, service, _, _) = test_router();
    let body = || Body::from(r#"{"actor":"bot|agent","on_behalf_of":"macro|owner@example.com"}"#);
    let user_request = Request::post("/doc-1/sync-content-updated")
        .header("authorization", format!("Bearer {JWT_TOKEN}"))
        .header("content-type", "application/json")
        .body(body())
        .unwrap();
    assert_eq!(
        send_status(&router, user_request).await,
        StatusCode::FORBIDDEN
    );
    assert!(service.sync_content_calls.lock().unwrap().is_empty());

    let internal_request = Request::post("/doc-1/sync-content-updated")
        .header(INTERNAL_API_KEY_HEADER, STANDARD_INTERNAL_KEY)
        .header("content-type", "application/json")
        .body(body())
        .unwrap();
    assert_eq!(send_status(&router, internal_request).await, StatusCode::OK);
    assert_eq!(
        *service.sync_content_calls.lock().unwrap(),
        [SyncContentCall {
            document_id: "doc-1".into(),
            editors: vec![crate::domain::events::DocumentSyncEditor {
                actor: "bot|agent".into(),
                on_behalf_of: Some("macro|owner@example.com".into()),
            }],
        }]
    );

    let forged_type = Request::post("/doc-1/sync-content-updated")
        .header(INTERNAL_API_KEY_HEADER, STANDARD_INTERNAL_KEY)
        .header("content-type", "application/json")
        .body(Body::from(r#"{"file_type":"md"}"#))
        .unwrap();
    assert_eq!(
        send_status(&router, forged_type).await,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(service.sync_content_calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn sync_notifications_forward_batched_editors() {
    let (router, service, _, _) = test_router();
    let request = Request::post("/doc-1/sync-content-updated")
        .header(INTERNAL_API_KEY_HEADER, STANDARD_INTERNAL_KEY)
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"editors":[{"actor":"macro|editor@example.com","on_behalf_of":null}]}"#,
        ))
        .unwrap();
    assert_eq!(send_status(&router, request).await, StatusCode::OK);
    let calls = service.sync_content_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].editors.len(), 1);
    assert_eq!(calls[0].editors[0].actor, "macro|editor@example.com");
}
