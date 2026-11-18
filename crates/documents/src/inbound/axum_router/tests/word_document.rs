use super::*;
use crate::domain::word_document::{NoWordDocumentFiles, WordDocumentService};
use crate::outbound::editing_worker_client::ReqwestEditingWorkerClient;

const WORD_ID: &str = "019fd3b9-3c6c-7c05-89c2-a27f01218141";
const SECRET: &str = "word-route-secret";

/// The sync service and editing worker in one: every Word document already
/// has a live copy, reads describe two blocks, and edits naming block
/// `missing` are refused as the worker refuses them.
async fn upstream() -> (String, Arc<Mutex<Vec<Value>>>) {
    let received = Arc::new(Mutex::new(Vec::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let sink = received.clone();
    let app = Router::new()
        .route(
            "/document/{document_id}/exists",
            axum::routing::head(|| async { StatusCode::OK }),
        )
        .route(
            "/docx",
            axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
                let sink = sink.clone();
                async move {
                    let refused = body["request"]["operations"][0]["id"] == "missing";
                    sink.lock().unwrap().push(body);
                    if refused {
                        (
                            StatusCode::UNPROCESSABLE_ENTITY,
                            axum::Json(json!({ "error": "No paragraph or block has id missing." })),
                        )
                    } else {
                        (
                            StatusCode::OK,
                            axum::Json(json!({ "content": "Word document with 2 blocks." })),
                        )
                    }
                }
            }),
        );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, received)
}

async fn word_router(
    file_type: FileType,
) -> (Router, Arc<Mutex<Vec<Value>>>, FakeEntityAccessService) {
    let (url, received) = upstream().await;
    let (mut state, documents, access, _) = test_state(NonUserOwners::Disabled);
    *documents.file_type.lock().unwrap() = Some(file_type);
    // Someone else's document, so the caller's access is checked.
    *documents.document_owner.lock().unwrap() =
        Some(Owner::from_principal_str("macro|file-owner@example.com").unwrap());
    state.word_documents = Arc::new(WordDocumentService::new(
        documents,
        Arc::new(ReqwestEditingWorkerClient::from_url(url.clone())),
        Arc::new(SyncServiceClient::new("internal-key".to_string(), url)),
        Arc::new(NoWordDocumentFiles),
        SECRET.to_string(),
    ));
    (router_for(state), received, access)
}

fn claims(body: &Value) -> Value {
    macro_sync_service_jwt::decode(body["documentToken"].as_str().unwrap(), SECRET).unwrap()
}

fn edit_request(authenticate: Authenticate, body: Value) -> Request<Body> {
    authenticate(
        Request::post(format!("/{WORD_ID}/word/edits")).header("content-type", "application/json"),
    )
    .body(Body::from(body.to_string()))
    .unwrap()
}

#[tokio::test]
async fn read_pages_the_live_copy_with_a_view_token_for_the_caller() {
    let (router, received, _) = word_router(FileType::Docx).await;

    let (status, body) = send(
        &router,
        with_jwt(Request::get(format!("/{WORD_ID}/word?start=3&count=10")))
            .body(Body::empty())
            .unwrap(),
    )
    .await;

    assert_eq!(
        (status, body),
        (
            StatusCode::OK,
            json!({ "content": "Word document with 2 blocks." })
        )
    );
    let received = received.lock().unwrap();
    assert_eq!(received.len(), 1);
    assert_eq!(
        received[0]["request"],
        json!({ "action": "read", "start": 3, "count": 10 })
    );
    let claims = claims(&received[0]);
    assert_eq!(claims["document_id"], WORD_ID);
    assert_eq!(claims["access_level"], "view");
    assert_eq!(claims["user_id"], JWT_USER_ID);
    assert_eq!(claims["actor"], Value::Null);
}

#[tokio::test]
async fn edits_by_a_bot_are_made_for_its_acting_user_and_signed_with_their_name() {
    let (router, received, _) = word_router(FileType::Docx).await;

    let (status, body) = send(
        &router,
        edit_request(
            with_user_bot,
            json!({
                "operations": [{ "type": "setStyle", "paragraph": "p1", "style": "Heading1" }],
                "trackChanges": true
            }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let received = received.lock().unwrap();
    assert_eq!(
        received[0]["request"],
        json!({
            "action": "edit",
            "operations": [{ "type": "setStyle", "paragraph": "p1", "style": "Heading1" }],
            "trackChanges": true,
            "author": "jwt-user"
        })
    );
    let claims = claims(&received[0]);
    assert_eq!(claims["access_level"], "edit");
    assert_eq!(claims["user_id"], JWT_USER_ID);
    assert_eq!(claims["actor"], BotId::TEST_A.into_storage_id().to_string());
}

#[tokio::test]
async fn operations_the_editor_refuses_are_the_callers_to_fix() {
    let (router, _, _) = word_router(FileType::Docx).await;

    let (status, body) = send(
        &router,
        edit_request(
            with_jwt,
            json!({ "operations": [{ "type": "delete", "id": "missing" }] }),
        ),
    )
    .await;

    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            json!({ "message": "bad request: No paragraph or block has id missing." })
        )
    );
}

#[tokio::test]
async fn edits_without_edit_access_never_reach_the_editor() {
    let (router, received, access) = word_router(FileType::Docx).await;
    access.deny_document_access();

    let status = send_status(
        &router,
        edit_request(
            with_jwt,
            json!({ "operations": [{ "type": "delete", "id": "p1" }] }),
        ),
    )
    .await;

    assert!(status.is_client_error(), "{status}");
    assert!(received.lock().unwrap().is_empty());
}

#[tokio::test]
async fn documents_that_are_not_word_files_never_reach_the_editor() {
    let (router, received, _) = word_router(FileType::Pdf).await;

    let (status, _) = send(
        &router,
        edit_request(
            with_jwt,
            json!({ "operations": [{ "type": "delete", "id": "p1" }] }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(received.lock().unwrap().is_empty());
}
