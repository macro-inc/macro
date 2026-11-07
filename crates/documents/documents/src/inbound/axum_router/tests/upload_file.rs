use super::*;

const PROJECT_ID: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_0123);

/// Object storage that accepts PUTs and keeps each body it receives.
pub(super) async fn object_storage() -> (String, Arc<Mutex<Vec<Vec<u8>>>>) {
    let received = Arc::new(Mutex::new(Vec::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/object", listener.local_addr().unwrap());
    let sink = received.clone();
    let app = Router::new().route(
        "/object",
        axum::routing::put(move |body: axum::body::Bytes| {
            let sink = sink.clone();
            async move {
                sink.lock().unwrap().push(body.to_vec());
                StatusCode::OK
            }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, received)
}

fn upload_request(authenticate: Authenticate, query: &str, bytes: Vec<u8>) -> Request<Body> {
    authenticate(
        Request::post(format!("/upload?{query}"))
            .header("content-type", "application/octet-stream"),
    )
    .body(Body::from(bytes))
    .unwrap()
}

#[tokio::test]
async fn upload_stores_the_body_as_a_document_created_by_the_resolved_principal() {
    for (authenticate, non_user_owners, principal) in creating_callers() {
        let (router, documents, _, _) = test_router_with(non_user_owners);
        let (url, received) = object_storage().await;
        *documents.upload_url.lock().unwrap() = Some(url);

        let (status, body) = send(
            &router,
            upload_request(
                authenticate,
                "fileName=report.pdf",
                b"%PDF-1.7 bytes".to_vec(),
            ),
        )
        .await;

        assert_eq!(
            (status, body),
            (
                StatusCode::OK,
                json!({ "documentId": "created-document", "sizeBytes": 14 })
            ),
            "{principal:?}"
        );
        assert_eq!(documents.create_calls(), [CreateDocumentCall { principal }]);
        assert_eq!(
            *documents.created_documents.lock().unwrap(),
            [CreatedDocumentCall {
                document_name: "report".to_string(),
                file_type: Some(FileType::Pdf),
                project_id: None,
            }]
        );
        assert_eq!(*received.lock().unwrap(), [b"%PDF-1.7 bytes".to_vec()]);
    }
}

#[tokio::test]
async fn upload_into_a_project_requires_the_callers_edit_access_to_it() {
    let (router, documents, access, _) = test_router();
    let (url, _received) = object_storage().await;
    *documents.upload_url.lock().unwrap() = Some(url);

    let (status, _) = send(
        &router,
        upload_request(
            with_jwt,
            &format!("fileName=data.csv&projectId={PROJECT_ID}"),
            b"a,b\n1,2\n".to_vec(),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        access.document_access_calls(),
        [DocumentAccessCall {
            user_id: JWT_USER_ID.to_string(),
            organization_id: Some(i64::from(TEST_ORGANIZATION_ID)),
            entity_id: PROJECT_ID.to_string(),
            entity_type: EntityType::Project,
        }]
    );
    assert_eq!(
        documents.created_documents.lock().unwrap()[0].project_id,
        Some(PROJECT_ID)
    );
}

#[tokio::test]
async fn upload_into_a_project_without_edit_access_creates_nothing() {
    let (router, documents, access, _) = test_router();
    access.deny_document_access();

    let status = send_status(
        &router,
        upload_request(
            with_jwt,
            &format!("fileName=data.csv&projectId={PROJECT_ID}"),
            b"a,b\n".to_vec(),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(documents.create_calls().is_empty());
}

#[tokio::test]
async fn upload_over_the_inline_limit_is_rejected_before_creating_a_document() {
    let (router, documents, _, _) = test_router();

    let status = send_status(
        &router,
        upload_request(
            with_jwt,
            "fileName=big.bin",
            vec![0; crate::domain::create::upload::MAX_INLINE_UPLOAD_BYTES + 1],
        ),
    )
    .await;

    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(documents.create_calls().is_empty());
}

#[tokio::test]
async fn upload_rejects_a_file_name_with_directories() {
    let (router, documents, _, _) = test_router();

    let (status, body) = send(
        &router,
        upload_request(with_jwt, "fileName=..%2Freport.pdf", b"bytes".to_vec()),
    )
    .await;

    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            json!({ "message": "bad request: fileName must be a filename without directory components or control characters" })
        )
    );
    assert!(documents.create_calls().is_empty());
}
