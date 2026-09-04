use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use agent::StreamPart;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, SessionNotification,
    TextContent,
};
use agent_client_protocol::{Client, ConnectionTo};
use rig_agent::agent::StreamingError;
use rig_agent::completion::PromptError;

use super::*;
use crate::domain::engine::TurnEngine;
use crate::testing::{HangingEngine, ScriptedEngine};

struct Harness {
    notifications: std::sync::Mutex<Vec<SessionNotification>>,
}

struct CancelledEngine;

impl TurnEngine for CancelledEngine {
    fn run_turn(
        &self,
        _request: TurnRequest,
    ) -> tokio::sync::mpsc::Receiver<Result<StreamPart, agent::AgentError>> {
        let (parts, receiver) = tokio::sync::mpsc::channel(1);
        tokio::spawn(async move {
            let cancellation = PromptError::PromptCancelled {
                chat_history: Vec::new(),
                reason: "user cancelled".to_owned(),
            };
            let error =
                agent::AgentError::Streaming(StreamingError::Prompt(Box::new(cancellation)));
            let _ = parts.send(Err(error)).await;
        });
        receiver
    }
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
        client_renders_forms: AtomicBool::new(false),
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
                assert_eq!(
                    initialized
                        .agent_info
                        .as_ref()
                        .map(|info| info.name.as_str()),
                    Some(AGENT_NAME),
                    "the fold recognizes this harness by its announced name"
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

/// Every tool call is stamped with the tool's name under `_meta.macro`, the
/// way Claude Code stamps `_meta.claudeCode.toolName`: an MCP tool as
/// `mcp__<server>__<tool>`, a delegation flagged `subagent`.
#[tokio::test]
async fn tool_calls_are_stamped_with_their_names_and_subagent_flag() {
    let engine = Arc::new(ScriptedEngine::new(vec![
        StreamPart::ToolCall(agent::ToolCall {
            id: "call-1".into(),
            name: "ReadContent".into(),
            json: serde_json::json!({"documentId": "d"}),
            mcp: None,
        }),
        StreamPart::ToolCall(agent::ToolCall {
            id: "call-2".into(),
            name: "Subagent".into(),
            json: serde_json::json!({"task": "count the beans"}),
            mcp: None,
        }),
        StreamPart::ToolCall(agent::ToolCall {
            id: "call-3".into(),
            name: "slack__search".into(),
            json: serde_json::json!({"query": "standup"}),
            mcp: Some(agent::McpInfo {
                service: "slack".into(),
                tool_name: "search".into(),
                display_name: Some("Search Slack".into()),
            }),
        }),
    ]));

    let (notifications, _) = with_agent(Arc::clone(&engine), async |connection, session| {
        connection
            .send_request(text_prompt(&session, "go"))
            .block_task()
            .await
            .expect("the prompt should complete")
    })
    .await;

    let metas: Vec<serde_json::Value> = notifications
        .iter()
        .filter_map(|notification| match &notification.update {
            SessionUpdate::ToolCall(call) => Some(serde_json::Value::Object(
                call.meta.clone().expect("meta is stamped"),
            )),
            _ => None,
        })
        .collect();
    assert_eq!(
        metas,
        vec![
            serde_json::json!({"macro": {"toolName": "ReadContent"}}),
            serde_json::json!({"macro": {"toolName": "Subagent", "subagent": true}}),
            serde_json::json!({"macro": {"toolName": "mcp__slack__search"}}),
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
async fn engine_cancellation_is_not_rendered_as_an_error_message() {
    let (notifications, response) =
        with_agent(Arc::new(CancelledEngine), async |connection, session| {
            connection
                .send_request(text_prompt(&session, "cancel me"))
                .block_task()
                .await
                .expect("a cancelled prompt still completes")
        })
        .await;

    assert_eq!(response.stop_reason, StopReason::Cancelled);
    assert!(notifications.is_empty());
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

/// Like [`with_agent`], but the client advertises form elicitation and
/// answers every `elicitation/create` with `answer`, recording what it was
/// asked.
async fn with_asking_agent<Out>(
    answer: agent_client_protocol::schema::v1::ElicitationAction,
    scenario: impl AsyncFnOnce(ConnectionTo<Agent>, SessionId) -> Out,
) -> (Vec<SessionNotification>, Vec<CreateElicitationRequest>, Out) {
    with_asking_engine(
        Arc::new(ScriptedEngine::new(vec![])),
        answer,
        Duration::ZERO,
        scenario,
    )
    .await
}

/// [`with_asking_agent`] over `engine`, with the client taking `delay` to
/// answer each question - the user's think time.
async fn with_asking_engine<Engine, Out>(
    engine: Arc<Engine>,
    answer: agent_client_protocol::schema::v1::ElicitationAction,
    delay: Duration,
    scenario: impl AsyncFnOnce(ConnectionTo<Agent>, SessionId) -> Out,
) -> (Vec<SessionNotification>, Vec<CreateElicitationRequest>, Out)
where
    Engine: TurnEngine,
{
    use agent_client_protocol::schema::v1::{
        ClientCapabilities, CreateElicitationResponse, ElicitationCapabilities,
        ElicitationFormCapabilities,
    };

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
        client_renders_forms: AtomicBool::new(false),
    });

    let (client_channel, agent_channel) = AcpChannel::duplex();
    let agent = tokio::spawn(serve(state, agent_channel));

    let notifications = Arc::new(std::sync::Mutex::new(Vec::new()));
    let asked = Arc::new(std::sync::Mutex::new(Vec::new()));
    let out = Client
        .builder()
        .on_receive_notification(
            {
                let notifications = Arc::clone(&notifications);
                async move |notification: SessionNotification, _connection| {
                    notifications.lock().unwrap().push(notification);
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            {
                let asked = Arc::clone(&asked);
                async move |request: CreateElicitationRequest, responder, connection| {
                    asked.lock().unwrap().push(request);
                    if delay.is_zero() {
                        return responder.respond(CreateElicitationResponse::new(answer.clone()));
                    }
                    // Answer off the dispatch loop so the delay does not hold
                    // up the notifications the agent keeps sending meanwhile.
                    let answer = answer.clone();
                    connection.spawn(async move {
                        tokio::time::sleep(delay).await;
                        let _ = responder.respond(CreateElicitationResponse::new(answer));
                        Ok(())
                    })?;
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(
            client_channel,
            async move |connection: ConnectionTo<Agent>| {
                connection
                    .send_request(
                        InitializeRequest::new(ProtocolVersion::V1).client_capabilities(
                            ClientCapabilities::new().elicitation(
                                ElicitationCapabilities::new()
                                    .form(ElicitationFormCapabilities::new()),
                            ),
                        ),
                    )
                    .block_task()
                    .await?;
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

    let notifications = notifications.lock().unwrap().clone();
    let asked = asked.lock().unwrap().clone();
    (notifications, asked, out)
}

fn spoken(notifications: &[SessionNotification]) -> String {
    notifications
        .iter()
        .filter_map(|notification| match &notification.update {
            SessionUpdate::AgentMessageChunk(chunk) => match &chunk.content {
                ContentBlock::Text(text) => Some(text.text.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn ask_sends_a_form_elicitation_and_echoes_the_accepted_answer() {
    use agent_client_protocol::schema::v1::{
        ElicitationAcceptAction, ElicitationAction, ElicitationContentValue, ElicitationMode,
    };
    use std::collections::BTreeMap;

    let answer =
        ElicitationAction::Accept(ElicitationAcceptAction::new().content(BTreeMap::from([(
            ASK_FIELD.to_owned(),
            ElicitationContentValue::String("blue".to_owned()),
        )])));
    let (notifications, asked, response) =
        with_asking_agent(answer, async |connection, session| {
            connection
                .send_request(text_prompt(
                    &session,
                    "/ask What is the best colour? | red | blue | green",
                ))
                .block_task()
                .await
                .expect("the ask should complete")
        })
        .await;

    assert_eq!(response.stop_reason, StopReason::EndTurn);
    assert_eq!(asked.len(), 1, "exactly one question was asked");
    assert_eq!(asked[0].message, "What is the best colour?");
    let ElicitationMode::Form(form) = &asked[0].mode else {
        panic!("a form was asked");
    };
    let field = form
        .requested_schema
        .properties
        .get(ASK_FIELD)
        .expect("the one field");
    let agent_client_protocol::schema::v1::ElicitationPropertySchema::String(field) = field else {
        panic!("a string field");
    };
    assert_eq!(
        field.one_of.as_ref().map(|options| options
            .iter()
            .map(|option| option.value.as_str())
            .collect::<Vec<_>>()),
        Some(vec!["red", "blue", "green"])
    );
    assert_eq!(
        form.requested_schema.required.as_deref(),
        Some(&[ASK_FIELD.to_owned()][..])
    );
    assert_eq!(spoken(&notifications), "You answered: blue");
}

#[tokio::test]
async fn ask_rejects_an_answer_outside_the_offered_options() {
    use std::collections::BTreeMap;

    use agent_client_protocol::schema::v1::{
        ElicitationAcceptAction, ElicitationAction, ElicitationContentValue,
    };

    let answer =
        ElicitationAction::Accept(ElicitationAcceptAction::new().content(BTreeMap::from([(
            ASK_FIELD.to_owned(),
            ElicitationContentValue::String("yellow".to_owned()),
        )])));
    let (notifications, _, response) = with_asking_agent(answer, async |connection, session| {
        connection
            .send_request(text_prompt(
                &session,
                "/ask What is the best colour? | red | blue | green",
            ))
            .block_task()
            .await
            .expect("the ask turn should complete with a validation message")
    })
    .await;

    assert_eq!(response.stop_reason, StopReason::EndTurn);
    assert!(
        spoken(&notifications).contains("was not one of the offered options"),
        "got {:?}",
        spoken(&notifications)
    );
}

#[tokio::test]
async fn ask_reports_a_decline_and_a_free_text_question_has_no_options() {
    use agent_client_protocol::schema::v1::{ElicitationAction, ElicitationMode};

    let (notifications, asked, response) =
        with_asking_agent(ElicitationAction::Decline, async |connection, session| {
            connection
                .send_request(text_prompt(&session, "/ask Name the service"))
                .block_task()
                .await
                .expect("the ask should complete")
        })
        .await;

    assert_eq!(response.stop_reason, StopReason::EndTurn);
    let ElicitationMode::Form(form) = &asked[0].mode else {
        panic!("a form was asked");
    };
    let agent_client_protocol::schema::v1::ElicitationPropertySchema::String(field) =
        &form.requested_schema.properties[ASK_FIELD]
    else {
        panic!("a string field");
    };
    assert!(field.one_of.is_none(), "free text has no options");
    assert_eq!(spoken(&notifications), "You declined to answer.");
}

/// An engine whose one tool asks the user a question through the turn's
/// user-input port and then says the answer - `AskUser` reduced to the part
/// the ACP surface cares about.
struct AskingEngine;

impl TurnEngine for AskingEngine {
    fn run_turn(
        &self,
        request: TurnRequest,
    ) -> tokio::sync::mpsc::Receiver<Result<StreamPart, agent::AgentError>> {
        let (parts, receiver) = tokio::sync::mpsc::channel(4);
        tokio::spawn(async move {
            let requester = request
                .user_input
                .expect("the client advertised forms, so the turn can ask");
            let outcome = requester
                .ask(UserInputRequest {
                    question: "Which colour?".to_owned(),
                    options: Vec::new(),
                })
                .await;
            let text = match outcome {
                Ok(UserInputOutcome::Answered(answer)) => format!("You said {answer}."),
                Ok(other) => format!("{other:?}"),
                Err(error) => error.to_string(),
            };
            let _ = parts.send(Ok(StreamPart::Content(text))).await;
        });
        receiver
    }
}

/// A user who takes longer than the idle timeout to answer is not a hung
/// turn: the question holds the timeout off, and the turn finishes on the
/// answer rather than being stopped for producing nothing meanwhile.
#[tokio::test(start_paused = true)]
async fn a_turn_waiting_on_the_user_outlasts_the_idle_timeout() {
    use agent_client_protocol::schema::v1::{
        ElicitationAcceptAction, ElicitationAction, ElicitationContentValue,
    };
    use std::collections::BTreeMap;

    let answer =
        ElicitationAction::Accept(ElicitationAcceptAction::new().content(BTreeMap::from([(
            ASK_FIELD.to_owned(),
            ElicitationContentValue::String("teal".to_owned()),
        )])));
    let (notifications, asked, response) = with_asking_engine(
        Arc::new(AskingEngine),
        answer,
        TURN_IDLE_TIMEOUT * 3,
        async |connection, session| {
            connection
                .send_request(text_prompt(&session, "pick a colour for me"))
                .block_task()
                .await
                .expect("the turn should complete")
        },
    )
    .await;

    assert_eq!(asked.len(), 1, "the tool asked once");
    assert_eq!(response.stop_reason, StopReason::EndTurn);
    assert_eq!(spoken(&notifications), "You said teal.");
}

/// The timeout still guards a turn that is silent with nothing asked.
#[tokio::test(start_paused = true)]
async fn a_silent_turn_with_no_question_out_is_stopped_by_the_idle_timeout() {
    let (notifications, response) =
        with_agent(Arc::new(HangingEngine), async |connection, session| {
            connection
                .send_request(text_prompt(&session, "hang"))
                .block_task()
                .await
                .expect("the turn should complete")
        })
        .await;

    assert_eq!(response.stop_reason, StopReason::Cancelled);
    assert!(
        spoken(&notifications).contains("produced nothing"),
        "got {:?}",
        spoken(&notifications)
    );
}

#[tokio::test]
async fn ask_without_form_support_explains_instead_of_asking() {
    let engine = Arc::new(ScriptedEngine::new(vec![]));
    let (notifications, response) = with_agent(engine, async |connection, session| {
        connection
            .send_request(text_prompt(&session, "/ask anything?"))
            .block_task()
            .await
            .expect("the ask should complete")
    })
    .await;

    assert_eq!(response.stop_reason, StopReason::EndTurn);
    assert!(
        spoken(&notifications).contains("did not advertise form elicitation"),
        "got {:?}",
        spoken(&notifications)
    );
}
