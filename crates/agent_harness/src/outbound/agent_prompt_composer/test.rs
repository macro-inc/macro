use super::*;
use crate::domain::model::{CommentAnchor, MarkedPassage, PriorMessage};
use axum::{Json, Router, routing::post};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn composition_preserves_lexical_output_without_tool_instructions() {
    let app = Router::new().route(
        "/agent-context",
        post(|| async { Json(serde_json::json!({ "markdown": "Sanitized prompt and context" })) }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let composer = LexicalAgentPromptComposer::new(LexicalClient::new(
        "test".into(),
        format!("http://{address}"),
    ));

    for context in [None, Some(&ConversationContext::default())] {
        let prompt = composer.compose("Raw prompt", None, context).await.unwrap();
        assert_eq!(prompt, "Sanitized prompt and context");
        assert!(!prompt.contains("set_pull_request"));
    }
    server.abort();
}

/// The comment anchor crosses a service boundary, so the shape the lexical
/// service validates is asserted here rather than only in its own types.
#[tokio::test]
async fn the_comment_anchor_reaches_the_lexical_service_beside_the_history() {
    let received: Arc<Mutex<Option<serde_json::Value>>> = Arc::default();
    let seen = received.clone();
    let app = Router::new().route(
        "/agent-context",
        post(move |Json(body): Json<serde_json::Value>| {
            let seen = seen.clone();
            async move {
                *seen.lock().unwrap() = Some(body);
                Json(serde_json::json!({ "markdown": "composed" }))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let composer = LexicalAgentPromptComposer::new(LexicalClient::new(
        "test".into(),
        format!("http://{address}"),
    ));

    composer
        .compose(
            "Raw prompt",
            None,
            Some(&ConversationContext {
                anchor: Some(CommentAnchor {
                    mark_id: "mark-1".to_owned(),
                    marked_text: Some("the marked phrase".to_owned()),
                    current: Some(MarkedPassage {
                        marked_text: "the edited phrase".to_owned(),
                        surrounding_text: "Around the edited phrase.".to_owned(),
                    }),
                }),
                messages: vec![PriorMessage {
                    sender: "alice".to_owned(),
                    content: "earlier".to_owned(),
                }],
            }),
        )
        .await
        .unwrap();
    let body = received.lock().unwrap().clone().unwrap();
    assert_eq!(body["anchor"]["markId"], "mark-1");
    assert_eq!(body["anchor"]["markedText"], "the marked phrase");
    assert_eq!(body["anchor"]["currentMarkedText"], "the edited phrase");
    assert_eq!(
        body["anchor"]["surroundingText"],
        "Around the edited phrase."
    );
    assert_eq!(body["messages"][0]["sender"], "alice");

    // A thread anchored before snapshots existed still names its mark.
    composer
        .compose(
            "Raw prompt",
            None,
            Some(&ConversationContext {
                anchor: Some(CommentAnchor {
                    mark_id: "mark-2".to_owned(),
                    marked_text: None,
                    current: None,
                }),
                messages: vec![],
            }),
        )
        .await
        .unwrap();
    let body = received.lock().unwrap().clone().unwrap();
    assert_eq!(body["anchor"]["markId"], "mark-2");
    assert!(body["anchor"].get("markedText").is_none());
    assert!(body["anchor"].get("currentMarkedText").is_none());
    server.abort();
}
