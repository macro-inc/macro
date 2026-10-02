use super::*;
use crate::testing::*;
use diffd_core::model::Side;

fn at(line: u32) -> Location {
    Location {
        path: "src/main.rs".into(),
        side: Side::New,
        line,
        end_line: None,
    }
}

#[tokio::test]
async fn disconnected_capture_releases_its_lease() {
    struct BlockedSource(tokio::sync::Notify);
    #[async_trait]
    impl ReviewSource for BlockedSource {
        async fn capture(&self, _: &AgentSession, _: &Comparison) -> Result<Capture> {
            self.0.notify_one();
            std::future::pending().await
        }
    }
    let f = Fixture::new();
    let source = Arc::new(BlockedSource(tokio::sync::Notify::new()));
    let service = Arc::new(ReviewService::new(
        f.sessions.clone(),
        f.repo.clone(),
        f.bodies.clone(),
        source.clone(),
        f.feedback.clone(),
        Arc::new(NoEvents),
        "http://localhost:3004".parse().unwrap(),
    ));
    let task = tokio::spawn(async move {
        service
            .capture(agent(), Comparison::default(), Presentation::default())
            .await
    });
    source.0.notified().await;
    assert!(matches!(
        f.service
            .capture(agent(), Comparison::default(), Presentation::default())
            .await,
        Err(ReviewError::Conflict)
    ));
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    let next = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            match f
                .service
                .capture(agent(), Comparison::default(), Presentation::default())
                .await
            {
                Err(ReviewError::Conflict) => tokio::task::yield_now().await,
                result => break result,
            }
        }
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(next.revision, 1);
}

#[tokio::test]
async fn immutable_revisions_and_citations_survive_relocation() {
    let f = Fixture::new();
    let first = f
        .service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    assert_eq!(first.revision, 1);
    assert_eq!(
        f.service
            .capture(agent(), Comparison::default(), Presentation::default())
            .await
            .unwrap()
            .revision,
        1
    );
    let link = f.service.link(agent(), 1, at(2)).await.unwrap();
    assert!(link.url.contains("s0.review.target="));
    *f.source.0.lock().unwrap() = capture("// moved\nfn main() {\n    hello();\n}");
    assert_eq!(
        f.service
            .capture(agent(), Comparison::default(), Presentation::default())
            .await
            .unwrap()
            .revision,
        2
    );
    let review = f.service.view(agent(), Some(1)).await.unwrap().unwrap();
    assert_eq!(review.anchors[0].original.line, 2);
    assert_eq!(review.anchors[0].current.line, 3);
    assert_eq!(review.anchors[0].status, AnchorStatus::Moved);
    assert!(review.revisions[1].files.is_empty());
    assert_eq!(
        f.service
            .file(agent(), 1, "src/main.rs")
            .await
            .unwrap()
            .new
            .unwrap()
            .lines[0],
        "fn main() {"
    );
    assert_eq!(
        f.service.link(agent(), 1, at(2)).await.unwrap().url,
        link.url
    );
}

#[tokio::test]
async fn historic_comments_anchor_immediately_and_retries_do_not_duplicate() {
    let f = Fixture::new();
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    *f.source.0.lock().unwrap() = capture("// moved\nfn main() {\n    hello();\n}");
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    let comment = Comment {
        id: Uuid::now_v7(),
        thread: None,
        revision: 1,
        location: Some(at(2)),
        body: "Why hello?".into(),
    };
    let link = f.service.comment(editor(), comment.clone()).await.unwrap();
    assert_eq!(
        f.service
            .comment(editor(), comment.clone())
            .await
            .unwrap()
            .url,
        link.url
    );
    let review = f.service.view(agent(), None).await.unwrap().unwrap();
    assert_eq!(review.threads.len(), 1);
    assert_eq!(review.threads[0].messages.len(), 1);
    assert_eq!(review.anchors[0].current.line, 3);
    let mut conflict = comment;
    conflict.body = "Different".into();
    assert!(matches!(
        f.service.comment(editor(), conflict).await,
        Err(ReviewError::Conflict)
    ));
    let id = Uuid::now_v7();
    f.service
        .reply(agent(), review.threads[0].id, id, "Checked it".into())
        .await
        .unwrap();
    f.service
        .reply(agent(), review.threads[0].id, id, "Checked it".into())
        .await
        .unwrap();
    assert_eq!(
        f.service
            .view(agent(), None)
            .await
            .unwrap()
            .unwrap()
            .threads[0]
            .messages
            .len(),
        2
    );
    assert!(matches!(
        f.service.resolve(agent(), review.threads[0].id, true).await,
        Err(ReviewError::Forbidden)
    ));
}

#[tokio::test]
async fn feedback_retries_admission_until_an_incoming_response_is_durable() {
    use agent_session::domain::{
        model::{AgentSessionLog, Message},
        ports::AgentSessionLogRepo,
    };
    let f = Fixture::new();
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    let id = Uuid::now_v7();
    f.service
        .comment(
            editor(),
            Comment {
                id,
                thread: None,
                revision: 1,
                location: Some(at(2)),
                body: "Please check".into(),
            },
        )
        .await
        .unwrap();
    f.repo.state.lock().unwrap().as_mut().unwrap().threads[0].messages[0].created_at -=
        chrono::Duration::seconds(2);
    f.service.deliver_pending().await.unwrap();
    f.service.deliver_pending().await.unwrap();
    assert_eq!(
        f.feedback.0.lock().unwrap().len(),
        2,
        "admission alone must not retire the outbox"
    );
    assert!(
        f.feedback.0.lock().unwrap()[0]
            .1
            .contains("macro_internal.diff_reply")
    );
    let response = serde_json::from_value(serde_json::json!({"type":"acp","jsonrpc":"2.0","id":id.to_string(),"result":{"stopReason":"end_turn"}})).unwrap();
    AgentSessionLogRepo::create(
        &f.sessions,
        AgentSessionLog {
            agent_session_id: AgentSessionId::TEST_A,
            user_id: None,
            content: Message::ToServer(response),
        },
    )
    .await
    .unwrap();
    // Recover a crash after the agent completed but before the UI metadata save.
    f.repo.state.lock().unwrap().as_mut().unwrap().threads[0].messages[0].delivery =
        Some(Delivery::Pending);
    f.service.deliver_pending().await.unwrap();
    f.service.deliver_pending().await.unwrap();
    assert_eq!(f.feedback.0.lock().unwrap().len(), 2);
    assert_eq!(
        f.repo.state.lock().unwrap().as_ref().unwrap().threads[0].messages[0].delivery,
        Some(Delivery::Queued)
    );
}

#[tokio::test]
async fn permissions_invalid_ranges_stale_annotations_and_duplicate_text_are_safe() {
    let f = Fixture::new();
    let wrong = ReviewAccess::Agent {
        session: AgentSessionId::TEST_A,
        owner: macro_user_id::user_id::MacroUserIdStr::try_from_email("intruder@example.com")
            .unwrap(),
    };
    assert!(matches!(
        f.service
            .capture(wrong, Comparison::default(), Presentation::default())
            .await,
        Err(ReviewError::Forbidden)
    ));
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    assert!(matches!(
        f.service.link(agent(), 1, at(0)).await,
        Err(ReviewError::Invalid(_))
    ));
    f.service.link(agent(), 1, at(2)).await.unwrap();
    *f.source.0.lock().unwrap() = capture("    hello();\n    hello();");
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    assert_eq!(
        f.service
            .view(agent(), None)
            .await
            .unwrap()
            .unwrap()
            .anchors[0]
            .status,
        AnchorStatus::Outdated
    );
    assert!(matches!(
        f.service
            .annotate(agent(), 1, Presentation::default())
            .await,
        Err(ReviewError::Conflict)
    ));
}

#[tokio::test]
async fn explicit_queue_cancellation_stops_review_recovery() {
    let f = Fixture::new();
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    let id = Uuid::now_v7();
    f.service
        .comment(
            editor(),
            Comment {
                id,
                thread: None,
                revision: 1,
                location: Some(at(2)),
                body: "Please check".into(),
            },
        )
        .await
        .unwrap();
    f.repo.state.lock().unwrap().as_mut().unwrap().threads[0].messages[0].created_at -=
        chrono::Duration::seconds(2);
    f.service.deliver_pending().await.unwrap();
    f.sessions
        .cancel_queued_action(
            AgentSessionId::TEST_A,
            agent_runtime_protocol::domain::action::AgentActionId::from_uuid(id),
            &[],
        )
        .await
        .unwrap();
    f.service.deliver_pending().await.unwrap();
    f.service.deliver_pending().await.unwrap();
    assert_eq!(f.feedback.0.lock().unwrap().len(), 1);
}
