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

#[cfg(feature = "ai_tools")]
#[tokio::test]
async fn spreadsheet_instructions_carry_usage_with_every_outcome() {
    use crate::domain::spreadsheet::SpreadsheetWriterOutcome;
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers};

    let worker = MockServer::start().await;
    Mock::given(matchers::method("POST"))
        .and(matchers::path("/spreadsheet/instructions"))
        .and(matchers::body_partial_json(serde_json::json!({
            "documentId": "document",
            "instructions": "Total the Revenue sheet.",
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "outcome": "refused",
            "reason": "There is no Revenue sheet.",
            "usage": [{"model": "claude-sonnet-5-5", "inputTokens": 400, "outputTokens": 30}],
        })))
        .mount(&worker)
        .await;

    let result = ReqwestEditingWorkerClient::from_url(worker.uri())
        .spreadsheet_instructions(
            "document",
            &"token".to_owned().into(),
            "Total the Revenue sheet.",
        )
        .await
        .unwrap();

    assert!(matches!(
        result.outcome,
        SpreadsheetWriterOutcome::Refused { reason } if reason == "There is no Revenue sheet."
    ));
    assert_eq!(result.usage.len(), 1);
    assert_eq!(result.usage[0].model, "claude-sonnet-5-5");
    assert_eq!(result.usage[0].input_tokens, 400);
    assert_eq!(result.usage[0].output_tokens, 30);
}

#[cfg(feature = "ai_tools")]
#[tokio::test]
async fn direct_markdown_edits_send_the_batch_and_read_each_outcome() {
    use crate::domain::markdown_edits::{
        BlockId, DeleteEdit, MarkdownEdit, MarkdownEditConflict, MarkdownEditConflictReason,
        MarkdownEditMerge, MarkdownEditOutcomeKind, MarkdownEditRefusalCode, MarkdownEditRequest,
    };
    use axum::{Json, Router, http::StatusCode, routing::post};

    let bodies = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
    let seen = bodies.clone();
    let app = Router::new().route(
        "/markdown",
        post(move |Json(body): Json<serde_json::Value>| {
            let seen = seen.clone();
            async move {
                let call = seen.lock().unwrap().len();
                seen.lock().unwrap().push(body);
                match call {
                    0 => (
                        StatusCode::OK,
                        Json(serde_json::json!({
                            "action": "edit",
                            "outcome": "committed",
                            "revision": "AQIE",
                            "merge": "current",
                            "changes": [{ "kind": "deleted", "blockId": "b1", "markdown": "Old." }],
                        })),
                    ),
                    1 => (
                        StatusCode::UNPROCESSABLE_ENTITY,
                        Json(serde_json::json!({
                            "error": "edit 1: no block with id b1",
                            "refusal": {
                                "code": "unknown_block",
                                "message": "edit 1: no block with id b1",
                                "edit": 1,
                                "blocks": [],
                            },
                        })),
                    ),
                    2 => (
                        StatusCode::CONFLICT,
                        Json(serde_json::json!({ "error": "the matched text is gone", "conflict": { "reason": "changed", "edit": 1 } })),
                    ),
                    3 => (
                        StatusCode::PAYLOAD_TOO_LARGE,
                        Json(serde_json::json!({ "error": "The document exceeds the 4 MiB snapshot limit." })),
                    ),
                    _ => (
                        StatusCode::CONFLICT,
                        Json(serde_json::json!({ "error": "The document changed since it was read." })),
                    ),
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
    let request = MarkdownEditRequest {
        edits: vec![MarkdownEdit::Delete(DeleteEdit {
            delete: BlockId::try_from("b1".to_owned()).unwrap(),
        })],
        base_revision: Some("AQID".into()),
        dry_run: false,
        allow_deleting_content: false,
    };

    let applied = client.edit_markdown("doc", &token, &request).await.unwrap();
    let refused = client.edit_markdown("doc", &token, &request).await.unwrap();
    let conflict = client.edit_markdown("doc", &token, &request).await.unwrap();
    let too_large = client.edit_markdown("doc", &token, &request).await.unwrap();
    let sync_conflict = client.edit_markdown("doc", &token, &request).await.unwrap();

    match applied {
        MarkdownEditOutcome::Applied(edited) => {
            assert_eq!(edited.outcome, MarkdownEditOutcomeKind::Committed);
            assert_eq!(edited.merge, Some(MarkdownEditMerge::Current));
            assert_eq!(edited.changes.len(), 1);
        }
        other => panic!("expected an applied batch, got {other:?}"),
    }
    match refused {
        MarkdownEditOutcome::Refused(refusal) => {
            assert_eq!(refusal.code, MarkdownEditRefusalCode::UnknownBlock);
            assert_eq!(refusal.edit, Some(1));
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert_eq!(
        conflict,
        MarkdownEditOutcome::Conflict(MarkdownEditConflict {
            reason: MarkdownEditConflictReason::Changed,
            message: "the matched text is gone".into(),
        })
    );
    assert!(
        matches!(&too_large, MarkdownEditOutcome::Invalid(message) if message.contains("4 MiB")),
        "a 4xx is not written: {too_large:?}"
    );
    assert_eq!(
        sync_conflict,
        MarkdownEditOutcome::Conflict(MarkdownEditConflict {
            reason: MarkdownEditConflictReason::Changed,
            message: "The document changed since it was read.".into(),
        })
    );
    assert_eq!(
        bodies.lock().unwrap()[0],
        serde_json::json!({
            "documentId": "doc",
            "documentToken": "test-token",
            "request": {
                "action": "edit",
                "edits": [{ "delete": "b1" }],
                "baseRevision": "AQID",
            },
        })
    );
}
