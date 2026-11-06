use super::*;
use std::time::Duration;

#[tokio::test]
async fn connection_failure_has_monitorable_context_and_preserves_cause() {
    // Reserve a port without listening so connection attempts are refused.
    let socket = tokio::net::TcpSocket::new_v4().unwrap();
    socket.bind("127.0.0.1:0".parse().unwrap()).unwrap();
    let client = ReqwestEditingWorkerClient::new(
        format!("http://{}", socket.local_addr().unwrap()),
        Arc::new(
            Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
        ),
    );

    let error = client
        .edit(
            "test-document",
            &"test-token".to_owned().into(),
            "edit",
            EditMode::Supervised,
            None,
        )
        .await
        .err()
        .expect("a connection to a port that is not listening must fail");

    assert_eq!(error.to_string(), "editing worker request failed");
    assert!(error.downcast_ref::<reqwest::Error>().unwrap().is_connect());
}

#[tokio::test]
async fn timeout_has_monitorable_context_and_preserves_cause() {
    // Keep the connection queued without serving a response.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = ReqwestEditingWorkerClient::new(
        format!("http://{}", listener.local_addr().unwrap()),
        Arc::new(
            Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(100))
                .build()
                .unwrap(),
        ),
    );

    let error = client
        .edit(
            "test-document",
            &"test-token".to_owned().into(),
            "edit",
            EditMode::Supervised,
            None,
        )
        .await
        .err()
        .expect("a worker that never responds must time out");

    assert_eq!(error.to_string(), "editing worker request failed");
    assert!(error.downcast_ref::<reqwest::Error>().unwrap().is_timeout());
}

#[cfg(feature = "ai_tools")]
#[tokio::test]
async fn word_document_requests_carry_the_token_and_surface_agent_errors() {
    use crate::domain::word_document::{WordDocumentOperation, WordDocumentRequest};
    use axum::{Json, Router, http::StatusCode, routing::post};

    let bodies = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
    let seen = bodies.clone();
    let app = Router::new().route(
        "/docx",
        post(move |Json(body): Json<serde_json::Value>| {
            let seen = seen.clone();
            async move {
                let edit = body["request"]["action"] == "edit";
                seen.lock().unwrap().push(body);
                if edit {
                    (
                        StatusCode::UNPROCESSABLE_ENTITY,
                        Json(serde_json::json!({ "error": "No paragraph or block has id x." })),
                    )
                } else {
                    (
                        StatusCode::OK,
                        Json(serde_json::json!({ "content": "Word document with 2 blocks." })),
                    )
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = ReqwestEditingWorkerClient::new(
        url,
        Arc::new(Client::builder().no_proxy().build().unwrap()),
    );
    let token = "test-token".to_owned().into();

    let read = client
        .word_document(
            "doc",
            &token,
            &WordDocumentRequest::Read {
                start: None,
                count: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(read.content, "Word document with 2 blocks.");

    let error = client
        .word_document(
            "doc",
            &token,
            &WordDocumentRequest::Edit {
                operations: vec![WordDocumentOperation::Delete { id: "x".into() }],
                track_changes: None,
                author: "Jacob Beckerman".into(),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(
        error
            .downcast_ref::<crate::domain::word_document::WordDocumentRejected>()
            .map(ToString::to_string),
        Some("No paragraph or block has id x.".to_owned())
    );

    let bodies = bodies.lock().unwrap();
    assert_eq!(
        bodies[0],
        serde_json::json!({
            "documentId": "doc",
            "documentToken": "test-token",
            "request": { "action": "read" },
        })
    );
    assert_eq!(
        bodies[1]["request"],
        serde_json::json!({
            "action": "edit",
            "operations": [{ "type": "delete", "id": "x" }],
            "author": "Jacob Beckerman",
        })
    );
}

#[cfg(feature = "ai_tools")]
#[tokio::test]
async fn edit_reports_the_revision_the_worker_left() {
    use axum::{Json, Router, routing::post};

    let app = Router::new().route(
        "/edit",
        post(|| async {
            Json(serde_json::json!({
                "ops": [{}, {}],
                "usage": [{ "model": "gemini-3.8-flash", "inputTokens": 12, "outputTokens": 3 }],
                "revision": "AQID",
            }))
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = ReqwestEditingWorkerClient::new(
        url,
        Arc::new(Client::builder().no_proxy().build().unwrap()),
    );

    let result = client
        .edit(
            "doc",
            &"test-token".to_owned().into(),
            "Replace Q3 with Q4",
            EditMode::Fast,
            None,
        )
        .await
        .unwrap();

    assert_eq!(result.edits_applied, 2);
    assert_eq!(result.clarification, None);
    assert_eq!(result.revision.as_deref(), Some("AQID"));
}

#[cfg(feature = "ai_tools")]
#[tokio::test]
async fn spreadsheet_statuses_keep_their_meaning() {
    use crate::domain::spreadsheet::{SpreadsheetError, SpreadsheetRequest};
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers};

    let worker = MockServer::start().await;
    for (prefix, status, error) in [
        (
            "/conflict",
            409,
            "The spreadsheet changed since it was read.",
        ),
        ("/invalid", 400, "Unknown sheet Forecast."),
        (
            "/unavailable",
            502,
            "The spreadsheet sync service is unavailable. Please retry.",
        ),
    ] {
        Mock::given(matchers::method("POST"))
            .and(matchers::path(format!("{prefix}/spreadsheet")))
            .respond_with(
                ResponseTemplate::new(status).set_body_json(serde_json::json!({ "error": error })),
            )
            .mount(&worker)
            .await;
    }
    let request = SpreadsheetRequest::Edit {
        expected_revision: "seen".into(),
        operations: vec![],
    };
    let token = "token".to_owned().into();

    let conflict = ReqwestEditingWorkerClient::from_url(format!("{}/conflict", worker.uri()))
        .spreadsheet("document", &token, &request)
        .await
        .unwrap_err();
    let invalid = ReqwestEditingWorkerClient::from_url(format!("{}/invalid", worker.uri()))
        .spreadsheet("document", &token, &request)
        .await
        .unwrap_err();
    let unavailable = ReqwestEditingWorkerClient::from_url(format!("{}/unavailable", worker.uri()))
        .spreadsheet("document", &token, &request)
        .await
        .unwrap_err();

    assert!(matches!(
        &conflict,
        SpreadsheetError::RevisionConflict(message)
            if message == "The spreadsheet changed since it was read."
    ));
    assert!(matches!(
        &invalid,
        SpreadsheetError::Invalid(message) if message == "Unknown sheet Forecast."
    ));
    assert!(matches!(unavailable, SpreadsheetError::Failed(_)));
}
