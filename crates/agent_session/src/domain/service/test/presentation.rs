use super::*;
use crate::domain::model::SessionToolPresentation;
use agent_client_protocol::schema::v1::{SessionUpdate, ToolCall, ToolCallStatus};
use std::time::Duration;

fn card() -> SessionToolPresentation {
    SessionToolPresentation {
        tool_call_id: "review_stable-id".into(),
        title: "mcp__macro_internal__PresentReview".into(),
        raw_input: serde_json::json!({"reviewId":"stable-id","kind":"email","title":"Draft"}),
        raw_output: serde_json::json!({"reviewId":"stable-id","message":"Presented to the user"}),
    }
}

#[tokio::test]
async fn presentation_is_durable_streamed_and_deduplicated_across_writers() {
    let realtime = RecordingRealtime::new();
    let (repo, mut writer) = fenced_connection(realtime.clone()).await;
    writer
        .present_tool(test_session(), SessionId::new("acp"), card())
        .await
        .unwrap();
    let first = repo.list_by_session(test_session()).await.unwrap();
    assert_eq!(first.len(), 2);
    assert_eq!(
        realtime
            .published()
            .iter()
            .map(|batch| batch.entries.len())
            .sum::<usize>(),
        2
    );
    writer
        .present_tool(test_session(), SessionId::new("acp"), card())
        .await
        .unwrap();
    assert_eq!(repo.list_by_session(test_session()).await.unwrap().len(), 2);
    let mut reconnected = connection(repo.clone());
    reconnected
        .present_tool(test_session(), SessionId::new("acp-new"), card())
        .await
        .unwrap();
    assert_eq!(repo.list_by_session(test_session()).await.unwrap().len(), 2);
    let mut conflicting = card();
    conflicting.raw_input = serde_json::json!({"different":true});
    assert!(
        reconnected
            .present_tool(test_session(), SessionId::new("acp"), conflicting)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn presentation_retry_completes_an_interrupted_pair() {
    let fx = fixture();
    let mut writer = connection(fx.repo.clone());
    let presentation = card();
    let frame = super::super::presentation::presentation_frame(
        fx.session,
        SessionId::new("acp"),
        SessionUpdate::ToolCall(
            ToolCall::new(presentation.tool_call_id, presentation.title)
                .status(ToolCallStatus::InProgress)
                .raw_input(presentation.raw_input),
        ),
    )
    .unwrap();
    writer.append(frame).await.unwrap();
    writer.flush().await.unwrap();
    assert_eq!(fx.repo.list_by_session(fx.session).await.unwrap().len(), 1);
    let mut reconnected = connection(fx.repo.clone());
    reconnected
        .present_tool(fx.session, SessionId::new("acp"), card())
        .await
        .unwrap();
    assert_eq!(fx.repo.list_by_session(fx.session).await.unwrap().len(), 2);
}

#[tokio::test]
async fn presentation_rejects_cross_owner_and_archived_before_actor_delivery() {
    let fx = fixture();
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com")
        .unwrap()
        .to_owned();
    assert!(matches!(
        fx.service.present_tool(fx.session, other, card()).await,
        Err(AgentSessionError::Forbidden)
    ));
    let mut session = fx.repo.get(fx.session).await.unwrap();
    let owner = session.owner_user().unwrap().to_owned();
    session.is_archived = true;
    fx.repo.insert_session(session);
    assert!(matches!(
        fx.service.present_tool(fx.session, owner, card()).await,
        Err(AgentSessionError::Archived(_))
    ));
}

#[tokio::test]
async fn presentation_actor_accepts_idle_and_running_turn_without_prompting() {
    let fx = fixture();
    let (outbound_tx, mut outbound_rx) = mpsc::channel(8);
    let (inbound_tx, inbound_rx) = mpsc::channel(8);
    fx.service
        .attach_session(
            fx.session,
            RuntimeAttachment::solo(RecordingTransport {
                outbound: outbound_tx,
                inbound: inbound_rx,
            }),
        )
        .await
        .unwrap();
    open_test_session(&inbound_tx, &mut outbound_rx, fx.session).await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while fx
            .repo
            .get(fx.session)
            .await
            .unwrap()
            .acp_session_id
            .is_none()
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let owner = fx
        .repo
        .get(fx.session)
        .await
        .unwrap()
        .owner_user()
        .unwrap()
        .to_owned();
    fx.service
        .present_tool(fx.session, owner.clone(), card())
        .await
        .unwrap();
    assert!(
        outbound_rx.try_recv().is_err(),
        "presenting must not prompt the runtime"
    );
    fx.service
        .deliver_action(
            fx.session,
            Some(owner.clone()),
            AgentAction::prompt("working"),
            AgentActionId::mint(),
        )
        .await
        .unwrap();
    let _prompt = outbound_rx.recv().await.unwrap();
    let mut during_turn = card();
    during_turn.tool_call_id = "review_while-running".into();
    tokio::time::timeout(
        Duration::from_secs(2),
        fx.service.present_tool(fx.session, owner, during_turn),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(outbound_rx.try_recv().is_err());
    let entries = fx.repo.list_by_session(fx.session).await.unwrap();
    let presented = entries
        .iter()
        .filter(|entry| {
            serde_json::to_string(&entry.entry.content)
                .unwrap()
                .contains("review_while-running")
        })
        .count();
    assert_eq!(presented, 2);
    fx.service.cancellation.cancel();
}

#[tokio::test]
async fn presentation_frames_fold_to_the_shared_mcp_card_for_every_runtime() {
    use agent_fold::domain::model::{ToolDetail, ToolName, ToolStatus};
    for runtime in ["macro-inmem", "cursor-acp", "codex-acp"] {
        let fx = fixture();
        let history = format!(
            r#"{{"direction":"to_runtime","content":{{"type":"acp","jsonrpc":"2.0","id":"init","method":"initialize","params":{{"protocolVersion":1,"clientCapabilities":{{}}}}}}}}
{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","id":"init","result":{{"protocolVersion":1,"agentCapabilities":{{}},"agentInfo":{{"name":"{runtime}","version":"test"}}}}}}}}
{{"direction":"to_runtime","content":{{"type":"acp","jsonrpc":"2.0","id":"prompt","method":"session/prompt","params":{{"sessionId":"acp","prompt":[{{"type":"text","text":"Prepare a review"}}]}}}}}}"#
        );
        fx.repo.extend_log(parse_log_as(fx.session, &history));
        let mut writer = connection(fx.repo.clone());
        writer
            .present_tool(fx.session, SessionId::new("acp"), card())
            .await
            .unwrap();
        let messages = fold(
            fx.repo
                .list_by_session(fx.session)
                .await
                .unwrap()
                .into_iter()
                .map(|stored| stored.entry),
        );
        let parts = messages
            .iter()
            .flat_map(|message| message.parts.iter())
            .collect::<Vec<_>>();
        assert!(
            parts
                .iter()
                .any(|part| matches!(part, MessagePart::ToolUse {
            id, name: ToolName::Mcp { server, tool }, status: ToolStatus::Completed,
            detail: ToolDetail::Other { .. },
        } if id.0 == "review_stable-id" && server == "macro_internal" && tool == "PresentReview")),
            "runtime {runtime}: {parts:?}"
        );
    }
}
