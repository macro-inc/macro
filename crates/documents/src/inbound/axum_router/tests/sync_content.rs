use super::*;

fn editor(actor: &str, on_behalf_of: Option<&str>) -> DocumentEditor {
    DocumentEditor::from_reported(actor.to_string(), on_behalf_of.map(str::to_string))
        .expect("valid actor id")
}

fn internal_post(body: &'static str) -> Request<Body> {
    Request::post("/doc-1/sync-content-updated")
        .header(INTERNAL_API_KEY_HEADER, STANDARD_INTERNAL_KEY)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap()
}

#[tokio::test]
async fn sync_notifications_require_internal_auth_and_forward_only_identity_and_attribution() {
    let (router, service, _, _) = test_router();
    let body = r#"{"editors":[{"actor":"bot|00000000-0000-0000-0000-00000000a1a1","on_behalf_of":"macro|owner@example.com"}]}"#;
    let user_request = Request::post("/doc-1/sync-content-updated")
        .header("authorization", format!("Bearer {JWT_TOKEN}"))
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap();
    assert_eq!(
        send_status(&router, user_request).await,
        StatusCode::FORBIDDEN
    );
    assert!(service.sync_content_calls.lock().unwrap().is_empty());

    assert_eq!(
        send_status(&router, internal_post(body)).await,
        StatusCode::OK
    );
    assert_eq!(
        *service.sync_content_calls.lock().unwrap(),
        [SyncContentCall {
            document_id: "doc-1".into(),
            editors: vec![editor(
                "bot|00000000-0000-0000-0000-00000000a1a1",
                Some("macro|owner@example.com")
            )],
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
async fn every_reported_editor_is_forwarded() {
    let (router, service, _, _) = test_router();
    let body = r#"{"editors":[
        {"actor":"macro|first@example.com","on_behalf_of":null},
        {"actor":"macro|second@example.com","on_behalf_of":null},
        {"actor":"not a principal","on_behalf_of":null}
    ]}"#;

    assert_eq!(
        send_status(&router, internal_post(body)).await,
        StatusCode::OK
    );
    assert_eq!(
        *service.sync_content_calls.lock().unwrap(),
        [SyncContentCall {
            document_id: "doc-1".into(),
            editors: vec![
                editor("macro|first@example.com", None),
                editor("macro|second@example.com", None),
            ],
        }],
        "unparseable actor ids drop without costing the rest of the publish"
    );
}

#[tokio::test]
async fn the_superseded_single_actor_is_still_accepted() {
    let (router, service, _, _) = test_router();
    let body = r#"{"actor":"bot|00000000-0000-0000-0000-00000000a1a1","on_behalf_of":"macro|owner@example.com"}"#;

    assert_eq!(
        send_status(&router, internal_post(body)).await,
        StatusCode::OK
    );
    assert_eq!(
        *service.sync_content_calls.lock().unwrap(),
        [SyncContentCall {
            document_id: "doc-1".into(),
            editors: vec![editor(
                "bot|00000000-0000-0000-0000-00000000a1a1",
                Some("macro|owner@example.com")
            )],
        }],
        "a sync deployment that predates `editors` keeps its attribution"
    );
}
