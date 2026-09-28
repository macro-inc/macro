use super::*;
use crate::domain::model::{
    CommentAnchor, ContextMessage, ContextThread, MarkedPassage, ReplyTarget,
};
use axum::{Json, Router, routing::post};
use macro_uuid::Uuid;
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
                anchor: Some(CommentAnchor::Mark {
                    mark_id: "mark-1".to_owned(),
                    marked_text: Some("the marked phrase".to_owned()),
                    current: Some(MarkedPassage {
                        marked_text: "the edited phrase".to_owned(),
                        surrounding_text: "Around the edited phrase.".to_owned(),
                    }),
                }),
                ..ConversationContext::default()
            }),
        )
        .await
        .unwrap();
    let body = received.lock().unwrap().clone().unwrap();
    assert_eq!(body["anchor"]["type"], "markdown");
    assert_eq!(body["anchor"]["markId"], "mark-1");
    assert_eq!(body["anchor"]["markedText"], "the marked phrase");
    assert_eq!(body["anchor"]["currentMarkedText"], "the edited phrase");
    assert_eq!(
        body["anchor"]["surroundingText"],
        "Around the edited phrase."
    );

    // A thread anchored before snapshots existed still names its mark.
    composer
        .compose(
            "Raw prompt",
            None,
            Some(&ConversationContext {
                anchor: Some(CommentAnchor::Mark {
                    mark_id: "mark-2".to_owned(),
                    marked_text: None,
                    current: None,
                }),
                ..ConversationContext::default()
            }),
        )
        .await
        .unwrap();
    let body = received.lock().unwrap().clone().unwrap();
    assert_eq!(body["anchor"]["markId"], "mark-2");
    assert!(body["anchor"].get("markedText").is_none());
    assert!(body["anchor"].get("currentMarkedText").is_none());

    let sent = |anchor: CommentAnchor| {
        let composer = &composer;
        let received = received.clone();
        async move {
            composer
                .compose(
                    "Raw prompt",
                    None,
                    Some(&ConversationContext {
                        anchor: Some(anchor),
                        ..ConversationContext::default()
                    }),
                )
                .await
                .unwrap();
            received.lock().unwrap().clone().unwrap()["anchor"].clone()
        }
    };
    assert_eq!(
        sent(CommentAnchor::PdfHighlight {
            anchor_id: "highlight-1".to_owned(),
            marked_text: Some("the highlighted words".to_owned()),
        })
        .await,
        serde_json::json!({
            "type": "pdfHighlight",
            "anchorId": "highlight-1",
            "markedText": "the highlighted words"
        })
    );
    assert_eq!(
        sent(CommentAnchor::PdfHighlight {
            anchor_id: "highlight-2".to_owned(),
            marked_text: None,
        })
        .await,
        serde_json::json!({ "type": "pdfHighlight", "anchorId": "highlight-2" })
    );
    assert_eq!(
        sent(CommentAnchor::PdfPin {
            anchor_id: "pin-1".to_owned(),
        })
        .await,
        serde_json::json!({ "type": "pdfPin", "anchorId": "pin-1" })
    );
    server.abort();
}

fn context_message(id: u128, content: &str) -> ContextMessage {
    ContextMessage {
        id: Uuid::from_u128(id),
        sender_id: "macro|alice@example.com".to_owned(),
        author: "alice@example.com".to_owned(),
        content: content.to_owned(),
        posted_at: chrono::DateTime::from_timestamp(1_758_800_000, 0).unwrap(),
    }
}

/// The discussion, the channel around it, and the reply target cross a
/// service boundary; the shape the lexical service validates is pinned here.
#[tokio::test]
async fn the_thread_channel_and_reply_target_reach_the_lexical_service() {
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

    let context = |reply_target| ConversationContext {
        reply_target: Some(reply_target),
        prompt_message_id: Some(Uuid::from_u128(3)),
        thread: Some(ContextThread {
            root_id: Uuid::from_u128(1),
            messages: vec![context_message(1, "the bug"), context_message(3, "fix it")],
            messages_omitted: false,
        }),
        channel: vec![ContextThread {
            root_id: Uuid::from_u128(5),
            messages: vec![context_message(6, "a reply elsewhere")],
            messages_omitted: true,
        }],
        ..ConversationContext::default()
    };
    let sent = |target| {
        let composer = &composer;
        let received = received.clone();
        let context = context(target);
        async move {
            composer
                .compose("Raw prompt", None, Some(&context))
                .await
                .unwrap();
            received.lock().unwrap().clone().unwrap()
        }
    };

    let body = sent(ReplyTarget::Thread {
        root_id: Uuid::from_u128(1),
    })
    .await;
    assert_eq!(
        body["replyTarget"],
        serde_json::json!({ "kind": "thread", "threadId": Uuid::from_u128(1).to_string() })
    );
    assert_eq!(body["promptMessageId"], Uuid::from_u128(3).to_string());
    assert_eq!(
        body["thread"]["messages"][0],
        serde_json::json!({
            "id": Uuid::from_u128(1).to_string(),
            "senderId": "macro|alice@example.com",
            "author": "alice@example.com",
            "content": "the bug",
            "postedAt": "2025-09-25T11:33:20Z",
        })
    );
    assert_eq!(body["thread"]["messagesOmitted"], false);
    assert_eq!(body["channel"][0]["rootId"], Uuid::from_u128(5).to_string());
    assert_eq!(body["channel"][0]["messagesOmitted"], true);

    let body = sent(ReplyTarget::Quote {
        message_id: Uuid::from_u128(1),
        thread_id: Uuid::from_u128(1),
        preview: "the bug".to_owned(),
        message: Some(context_message(1, "the bug")),
    })
    .await;
    assert_eq!(body["replyTarget"]["kind"], "quote");
    assert_eq!(body["replyTarget"]["preview"], "the bug");
    assert_eq!(body["replyTarget"]["message"]["content"], "the bug");

    let body = sent(ReplyTarget::None).await;
    assert_eq!(body["replyTarget"], serde_json::json!({ "kind": "none" }));
    server.abort();
}
