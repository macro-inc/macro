use std::sync::Arc;

use agent::StreamPart;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, SessionNotification,
    TextContent,
};
use agent_client_protocol::{Client, ConnectionTo};

use super::*;
use crate::domain::engine::TurnEngine;
use crate::testing::{HangingEngine, ScriptedEngine};

struct Harness {
    notifications: std::sync::Mutex<Vec<SessionNotification>>,
}

/// Drive the served agent as a scripted ACP client: initialize, open a
/// session, then hand the connection to `scenario`.
async fn with_agent<Engine, Out>(
    engine: Arc<Engine>,
    scenario: impl AsyncFnOnce(ConnectionTo<Agent>, SessionId) -> Out,
) -> (Vec<SessionNotification>, Out)
where
    Engine: TurnEngine,
{
    let store = Arc::new(SessionStore::new());
    let session_id = AgentSessionId::new();
    store.insert(
        session_id,
        crate::domain::session::SessionState::new("test-model".into()),
    );
    let state = Arc::new(AgentState {
        session_id,
        owner: MacroUserIdStr::try_from_email("owner@macro.com").expect("a valid user id"),
        engine,
        store,
        active_cancel: std::sync::Mutex::new(Vec::new()),
        turn_lock: tokio::sync::Mutex::new(()),
    });

    let (client_channel, agent_channel) = AcpChannel::duplex();
    let agent = tokio::spawn(serve(state, agent_channel));

    let harness = Arc::new(Harness {
        notifications: std::sync::Mutex::new(Vec::new()),
    });
    let observed = Arc::clone(&harness);
    let out = Client
        .builder()
        .on_receive_notification(
            async move |notification: SessionNotification, _connection| {
                observed
                    .notifications
                    .lock()
                    .expect("notifications lock")
                    .push(notification);
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_with(
            client_channel,
            async move |connection: ConnectionTo<Agent>| {
                let initialized = connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;
                assert!(
                    initialized
                        .agent_capabilities
                        .session_capabilities
                        .resume
                        .is_some(),
                    "the agent must declare resume support or reattachment dies"
                );
                let session = connection
                    .send_request(NewSessionRequest::new("/"))
                    .block_task()
                    .await?;
                Ok(scenario(connection, session.session_id).await)
            },
        )
        .await
        .expect("the scripted client should run clean");
    agent.abort();

    let notifications = harness
        .notifications
        .lock()
        .expect("notifications lock")
        .clone();
    (notifications, out)
}

fn text_prompt(session: &SessionId, text: &str) -> PromptRequest {
    PromptRequest::new(
        session.clone(),
        vec![ContentBlock::Text(TextContent::new(text))],
    )
}

#[tokio::test]
async fn a_prompt_streams_updates_and_ends_the_turn() {
    let engine = Arc::new(ScriptedEngine::new(vec![
        StreamPart::Thinking("hmm".into()),
        StreamPart::Content("Hello ".into()),
        StreamPart::ToolCall(agent::ToolCall {
            id: "call-1".into(),
            name: "NameSearch".into(),
            json: serde_json::json!({"query": "roadmap"}),
            mcp: None,
        }),
        StreamPart::ToolResponse(agent::ToolResponse::Json {
            id: "call-1".into(),
            json: serde_json::json!({"hits": 1}),
            name: "NameSearch".into(),
        }),
        StreamPart::Content("world".into()),
    ]));

    let (notifications, response) = with_agent(Arc::clone(&engine), async |connection, session| {
        connection
            .send_request(text_prompt(&session, "find the roadmap"))
            .block_task()
            .await
            .expect("the prompt should complete")
    })
    .await;

    assert_eq!(response.stop_reason, StopReason::EndTurn);
    let kinds: Vec<&'static str> = notifications
        .iter()
        .map(|notification| match &notification.update {
            SessionUpdate::AgentThoughtChunk(_) => "thought",
            SessionUpdate::AgentMessageChunk(_) => "message",
            SessionUpdate::ToolCall(_) => "tool_call",
            SessionUpdate::ToolCallUpdate(_) => "tool_call_update",
            _ => "other",
        })
        .collect();
    assert_eq!(
        kinds,
        vec![
            "thought",
            "message",
            "tool_call",
            "tool_call_update",
            "message"
        ]
    );
}

#[tokio::test]
async fn turns_accumulate_history_and_send_the_model() {
    let engine = Arc::new(ScriptedEngine::new(vec![StreamPart::Content("ok".into())]));

    with_agent(Arc::clone(&engine), async |connection, session| {
        for prompt in ["first", "second"] {
            connection
                .send_request(text_prompt(&session, prompt))
                .block_task()
                .await
                .expect("the prompt should complete");
        }
    })
    .await;

    let requests = engine.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].model, "test-model");
    assert_eq!(requests[0].messages, vec!["first".to_owned()]);
    // The second turn carries the first turn's prompt and reply.
    assert_eq!(
        requests[1].messages,
        vec!["first".to_owned(), "ok".to_owned(), "second".to_owned()]
    );
}

#[tokio::test]
async fn compact_clears_history_without_running_a_turn() {
    let engine = Arc::new(ScriptedEngine::new(vec![StreamPart::Content("ok".into())]));

    with_agent(Arc::clone(&engine), async |connection, session| {
        connection
            .send_request(text_prompt(&session, "remember this"))
            .block_task()
            .await
            .expect("the prompt should complete");
        let response = connection
            .send_request(text_prompt(&session, "/compact"))
            .block_task()
            .await
            .expect("compaction should complete");
        assert_eq!(response.stop_reason, StopReason::EndTurn);
        connection
            .send_request(text_prompt(&session, "after"))
            .block_task()
            .await
            .expect("the prompt should complete");
    })
    .await;

    let requests = engine.requests();
    assert_eq!(requests.len(), 2, "/compact must not reach the engine");
    assert_eq!(
        requests[1].messages,
        vec!["after".to_owned()],
        "compaction empties the conversation"
    );
}

#[tokio::test]
async fn cancel_stops_the_turn_with_the_cancelled_stop_reason() {
    let engine = Arc::new(HangingEngine);

    let (_notifications, response) = with_agent(engine, async |connection, session| {
        let pending = connection.send_request(text_prompt(&session, "hang"));
        let cancel = agent_client_protocol::schema::v1::CancelNotification::new(session.clone());
        connection
            .send_notification(cancel)
            .expect("the cancel notification should send");
        pending
            .block_task()
            .await
            .expect("a cancelled prompt still completes")
    })
    .await;

    assert_eq!(response.stop_reason, StopReason::Cancelled);
}

#[tokio::test]
async fn a_prompt_for_an_unknown_session_is_refused() {
    let engine = Arc::new(ScriptedEngine::new(vec![]));

    with_agent(engine, async |connection, _session| {
        let error = connection
            .send_request(text_prompt(&SessionId::new("not-a-session"), "hi"))
            .block_task()
            .await
            .expect_err("a foreign session id must be refused");
        assert_eq!(
            error.code,
            agent_client_protocol::schema::v1::ErrorCode::InvalidParams
        );
    })
    .await;
}
