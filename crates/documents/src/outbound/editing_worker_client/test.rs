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
        error.to_string(),
        "No paragraph or block has id x. (HTTP 422 Unprocessable Entity)"
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
async fn document_ops_send_the_batch_and_map_each_worker_outcome() {
    use crate::domain::ports::editing::DocumentOpFailure;
    use axum::{Json, Router, http::StatusCode, routing::post};

    let bodies = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
    let seen = bodies.clone();
    let app = Router::new().route(
        "/document-ops",
        post(move |Json(body): Json<serde_json::Value>| {
            let seen = seen.clone();
            async move {
                let reply = match body["documentId"].as_str() {
                    Some("applied") => (
                        StatusCode::OK,
                        serde_json::json!({ "applied": 2, "changedBlockIds": ["k3Fq"], "revision": "AQID" }),
                    ),
                    Some("rejected") => (
                        StatusCode::UNPROCESSABLE_ENTITY,
                        serde_json::json!({
                            "error": "edit_rejected",
                            "failures": [{ "index": 1, "kind": "node_not_found", "message": "no node k3Fq" }],
                        }),
                    ),
                    Some("unacknowledged") => (
                        StatusCode::BAD_GATEWAY,
                        serde_json::json!({ "error": "unacknowledged", "message": "sync service timed out" }),
                    ),
                    Some("invalid") => (
                        StatusCode::BAD_REQUEST,
                        serde_json::json!({ "error": "operations[0].type is unknown" }),
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
    let serde_json::Value::Object(op) =
        serde_json::json!({ "kind": "replace", "nodeId": "k3Fq", "find": "Q3", "replace": "Q4" })
    else {
        panic!("op literal is an object")
    };
    let operations = vec![op];

    assert_eq!(
        client
            .document_ops("applied", &token, &operations, EditorName::new("Macro"))
            .await
            .unwrap(),
        DocumentOpsOutcome::Applied {
            applied: 2,
            changed_block_ids: vec!["k3Fq".to_string()],
            revision: "AQID".to_string(),
        }
    );
    assert_eq!(
        client
            .document_ops("rejected", &token, &operations, None)
            .await
            .unwrap(),
        DocumentOpsOutcome::Rejected(vec![DocumentOpFailure {
            index: 1,
            kind: "node_not_found".to_string(),
            message: "no node k3Fq".to_string(),
        }])
    );
    assert_eq!(
        client
            .document_ops("unacknowledged", &token, &operations, None)
            .await
            .unwrap(),
        DocumentOpsOutcome::Unacknowledged("sync service timed out".to_string())
    );
    assert_eq!(
        client
            .document_ops("invalid", &token, &operations, None)
            .await
            .unwrap(),
        DocumentOpsOutcome::Invalid("operations[0].type is unknown".to_string())
    );
    assert_eq!(
        client
            .document_ops("forbidden", &token, &operations, None)
            .await
            .unwrap_err()
            .to_string(),
        r#"editing worker returned 403 Forbidden: {"error":"token lacks edit access"}"#
    );

    let bodies = bodies.lock().unwrap();
    assert_eq!(
        bodies[0],
        serde_json::json!({
            "documentId": "applied",
            "documentToken": "test-token",
            "operations": [{ "kind": "replace", "nodeId": "k3Fq", "find": "Q3", "replace": "Q4" }],
            "editor": { "name": "Macro" },
        })
    );
    assert_eq!(bodies[1].get("editor"), None);
}
