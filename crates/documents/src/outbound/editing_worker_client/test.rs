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
async fn lexical_state_reads_the_state_and_revision_and_surfaces_worker_errors() {
    use crate::domain::lexical::DocumentLexicalState;
    use axum::{Json, Router, http::StatusCode, routing::post};

    let bodies = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
    let seen = bodies.clone();
    let app = Router::new().route(
        "/lexical-state",
        post(move |Json(body): Json<serde_json::Value>| {
            let seen = seen.clone();
            async move {
                let reply = match body["documentId"].as_str() {
                    Some("doc") => (
                        StatusCode::OK,
                        serde_json::json!({
                            "state": { "root": { "type": "root", "children": [] } },
                            "revision": "AQID",
                        }),
                    ),
                    _ => (
                        StatusCode::BAD_GATEWAY,
                        serde_json::json!({ "error": "sync_failed", "message": "sync service closed" }),
                    ),
                };
                seen.lock().unwrap().push(body);
                (reply.0, Json(reply.1))
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

    assert_eq!(
        client.lexical_state("doc", &token).await.unwrap(),
        DocumentLexicalState {
            state: serde_json::json!({ "root": { "type": "root", "children": [] } }),
            revision: "AQID".to_string(),
        }
    );
    assert_eq!(
        client
            .lexical_state("unsynced", &token)
            .await
            .unwrap_err()
            .to_string(),
        r#"editing worker returned 502 Bad Gateway: {"error":"sync_failed","message":"sync service closed"}"#
    );
    assert_eq!(
        bodies.lock().unwrap()[0],
        serde_json::json!({ "documentId": "doc", "documentToken": "test-token" })
    );
}

#[cfg(feature = "ai_tools")]
#[tokio::test]
async fn lexical_commit_sends_the_blocks_and_maps_each_worker_outcome() {
    use crate::domain::lexical::{
        DocumentLexicalBlock, DocumentLexicalCommitRequest, DocumentLexicalCommitted,
        DocumentLexicalConflictReason, DocumentLexicalNodeConflict, LexicalCommitOutcome,
    };
    use axum::{Json, Router, http::StatusCode, routing::post};

    let bodies = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
    let seen = bodies.clone();
    let app = Router::new().route(
        "/lexical-commit",
        post(move |Json(body): Json<serde_json::Value>| {
            let seen = seen.clone();
            async move {
                let reply = match body["documentId"].as_str() {
                    Some("committed") => (
                        StatusCode::OK,
                        serde_json::json!({
                            "revision": "BAUG",
                            "state": { "root": { "type": "root", "children": [] } },
                        }),
                    ),
                    Some("conflict") => (
                        StatusCode::CONFLICT,
                        serde_json::json!({
                            "error": "conflict",
                            "conflicts": [
                                { "id": "k3Fq", "reason": "moved" },
                                { "id": null, "reason": "revision" },
                            ],
                        }),
                    ),
                    Some("invalid") => (
                        StatusCode::UNPROCESSABLE_ENTITY,
                        serde_json::json!({ "error": "invalid", "message": "unknown node type: banner" }),
                    ),
                    Some("unacknowledged") => (
                        StatusCode::BAD_GATEWAY,
                        serde_json::json!({ "error": "unacknowledged", "message": "sync service timed out" }),
                    ),
                    Some("aborted") => (
                        StatusCode::GATEWAY_TIMEOUT,
                        serde_json::json!({ "error": "aborted" }),
                    ),
                    _ => (
                        StatusCode::FORBIDDEN,
                        serde_json::json!({ "error": "token lacks edit access" }),
                    ),
                };
                seen.lock().unwrap().push(body);
                (reply.0, Json(reply.1))
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
    let commit = DocumentLexicalCommitRequest {
        revision: "AQID".to_string(),
        blocks: vec![DocumentLexicalBlock {
            id: "k3Fq".to_string(),
            after: None,
            node: serde_json::json!({ "type": "paragraph", "version": 1, "$": { "id": "k3Fq" }, "children": [] }),
        }],
        removed: vec!["p9Zx".to_string()],
    };

    assert_eq!(
        client
            .lexical_commit("committed", &token, &commit, EditorName::new("Macro"))
            .await
            .unwrap(),
        LexicalCommitOutcome::Committed(DocumentLexicalCommitted {
            revision: "BAUG".to_string(),
            state: serde_json::json!({ "root": { "type": "root", "children": [] } }),
        })
    );
    assert_eq!(
        client
            .lexical_commit("conflict", &token, &commit, None)
            .await
            .unwrap(),
        LexicalCommitOutcome::Conflict(vec![
            DocumentLexicalNodeConflict {
                id: Some("k3Fq".to_string()),
                reason: DocumentLexicalConflictReason::Moved,
            },
            DocumentLexicalNodeConflict {
                id: None,
                reason: DocumentLexicalConflictReason::Revision,
            },
        ])
    );
    assert_eq!(
        client
            .lexical_commit("invalid", &token, &commit, None)
            .await
            .unwrap(),
        LexicalCommitOutcome::Invalid("unknown node type: banner".to_string())
    );
    assert_eq!(
        client
            .lexical_commit("unacknowledged", &token, &commit, None)
            .await
            .unwrap(),
        LexicalCommitOutcome::Unacknowledged("sync service timed out".to_string())
    );
    assert_eq!(
        client
            .lexical_commit("aborted", &token, &commit, None)
            .await
            .unwrap(),
        LexicalCommitOutcome::Unacknowledged(
            r#"editing worker returned 504 Gateway Timeout: {"error":"aborted"}"#.to_string()
        )
    );
    assert_eq!(
        client
            .lexical_commit("forbidden", &token, &commit, None)
            .await
            .unwrap_err()
            .to_string(),
        r#"editing worker returned 403 Forbidden: {"error":"token lacks edit access"}"#
    );

    let bodies = bodies.lock().unwrap();
    assert_eq!(
        bodies[0],
        serde_json::json!({
            "documentId": "committed",
            "documentToken": "test-token",
            "revision": "AQID",
            "blocks": [{
                "id": "k3Fq",
                "after": null,
                "node": { "type": "paragraph", "version": 1, "$": { "id": "k3Fq" }, "children": [] },
            }],
            "removed": ["p9Zx"],
            "editor": { "name": "Macro" },
        })
    );
    assert_eq!(bodies[1].get("editor"), None);
}

#[cfg(feature = "ai_tools")]
#[tokio::test]
async fn a_lexical_commit_that_never_connects_failed_and_one_that_times_out_is_unknown() {
    use crate::domain::lexical::{DocumentLexicalCommitRequest, LexicalCommitOutcome};

    let commit = DocumentLexicalCommitRequest {
        revision: "AQID".to_string(),
        blocks: Vec::new(),
        removed: vec!["p9Zx".to_string()],
    };
    let token = "test-token".to_owned().into();
    // Reserve a port without listening so connection attempts are refused.
    let socket = tokio::net::TcpSocket::new_v4().unwrap();
    socket.bind("127.0.0.1:0".parse().unwrap()).unwrap();
    let refused = ReqwestEditingWorkerClient::new(
        format!("http://{}", socket.local_addr().unwrap()),
        Arc::new(Client::builder().no_proxy().build().unwrap()),
    );
    // Keep the connection queued without serving a response.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let silent = ReqwestEditingWorkerClient::new(
        format!("http://{}", listener.local_addr().unwrap()),
        Arc::new(
            Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(100))
                .build()
                .unwrap(),
        ),
    );

    let error = refused
        .lexical_commit("doc", &token, &commit, None)
        .await
        .unwrap_err();
    let outcome = silent
        .lexical_commit("doc", &token, &commit, None)
        .await
        .unwrap();

    assert_eq!(error.to_string(), "editing worker request failed");
    assert!(error.downcast_ref::<reqwest::Error>().unwrap().is_connect());
    assert!(
        matches!(&outcome, LexicalCommitOutcome::Unacknowledged(message) if message.starts_with("editing worker request failed after it was sent")),
        "{outcome:?}"
    );
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
