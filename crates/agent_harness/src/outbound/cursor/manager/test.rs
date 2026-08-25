use super::*;
use crate::domain::model::AgentKind;
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::ports::{Transport as _, TransportSender as _};
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToRuntimeMessage, ToServerMessage};
use agent_session::domain::error::Result as SessionResult;
use agent_session::domain::model::{
    AgentSession, ChannelSession, CreateAgentSessionParams, DEFAULT_AGENT_SESSION_NAME,
    SandboxSize, SessionBot, SessionStatus,
};
use bot_id::BotId;
use cursor_api_key::cipher::CursorApiKey;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// In-memory sessions double: a real map for the external rows, a canned row
/// for the one session the test asks about, and loud failure for everything
/// the manager has no business calling.
#[derive(Clone, Default)]
struct StubSessions {
    external: Arc<Mutex<HashMap<AgentSessionId, ExternalSession>>>,
    acp_session_id: Arc<Mutex<Option<String>>>,
}

impl ExternalSessionRepo for StubSessions {
    async fn upsert(&self, id: AgentSessionId, external: ExternalSession) -> SessionResult<()> {
        self.external
            .lock()
            .expect("stub poisoned")
            .insert(id, external);
        Ok(())
    }

    async fn get(&self, id: AgentSessionId) -> SessionResult<Option<ExternalSession>> {
        Ok(self
            .external
            .lock()
            .expect("stub poisoned")
            .get(&id)
            .cloned())
    }

    async fn delete(&self, id: AgentSessionId) -> SessionResult<()> {
        self.external.lock().expect("stub poisoned").remove(&id);
        Ok(())
    }
}

impl AgentSessionRepo for StubSessions {
    async fn create(&self, _params: CreateAgentSessionParams) -> SessionResult<AgentSession> {
        unimplemented!("the manager never creates sessions")
    }

    async fn get(&self, id: AgentSessionId) -> SessionResult<AgentSession> {
        Ok(AgentSession {
            id,
            owner_id: MacroUserIdStr::try_from("macro|owner@macro.com".to_owned())
                .expect("valid user id"),
            thread_id: None,
            thread_channel_id: None,
            originating_message_id: None,
            bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
            model: "auto".to_owned(),
            harness: "cursor".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            name: DEFAULT_AGENT_SESSION_NAME.to_owned(),
            sandbox_size: SandboxSize::Default,
            acp_session_id: self
                .acp_session_id
                .lock()
                .expect("stub poisoned")
                .clone()
                .map(SessionId::new),
            external: None,
            status: SessionStatus::NoMessages,
            created_at: chrono::Utc::now(),
            modified_at: chrono::Utc::now(),
        })
    }

    async fn find_for_channel(
        &self,
        _thread_id: Option<macro_uuid::Uuid>,
        _bot_id: Option<BotId>,
    ) -> SessionResult<ChannelSession> {
        unimplemented!("the manager never routes channel events")
    }

    async fn session_bot(&self, _id: BotId) -> SessionResult<SessionBot> {
        unimplemented!("the manager never renders bots")
    }

    async fn set_acp_session_id(
        &self,
        _id: AgentSessionId,
        _acp_session_id: SessionId,
    ) -> SessionResult<()> {
        unimplemented!("persisting the acp session id is the session actor's job")
    }

    async fn set_model(&self, _id: AgentSessionId, _model: &str) -> SessionResult<()> {
        unimplemented!("the manager never sets models")
    }

    async fn delete(&self, _id: AgentSessionId) -> SessionResult<()> {
        unimplemented!("deleting sessions is the harness service's job")
    }

    async fn set_name(&self, _id: AgentSessionId, _name: &str) -> SessionResult<()> {
        unimplemented!("naming sessions is the session actor's job")
    }

    async fn set_name_if_default(&self, _id: AgentSessionId, _name: &str) -> SessionResult<bool> {
        unimplemented!("naming sessions is the session actor's job")
    }

    async fn set_sandbox_size(&self, _id: AgentSessionId, _size: SandboxSize) -> SessionResult<()> {
        unimplemented!("resizing is the harness service's job")
    }

    async fn user_sandbox_size(
        &self,
        _owner: &MacroUserIdStr<'static>,
    ) -> SessionResult<SandboxSize> {
        unimplemented!("resizing is the harness service's job")
    }

    async fn set_user_sandbox_size(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _size: SandboxSize,
    ) -> SessionResult<()> {
        unimplemented!("resizing is the harness service's job")
    }
}

/// A fake Cursor API: create/get/archive/stream, canned. Returns its base url
/// and the archive-call log.
async fn fake_cursor_api() -> (String, Arc<Mutex<Vec<String>>>) {
    let archived = Arc::new(Mutex::new(Vec::<String>::new()));
    let archive_log = archived.clone();
    let app = axum::Router::new()
        .route(
            "/v1/agents",
            axum::routing::post(|| async {
                axum::Json(serde_json::json!({
                    "agent": {
                        "id": "bc-test-agent",
                        "name": "Add a health check",
                        "status": "ACTIVE",
                        "url": "https://cursor.com/agents/bc-test-agent",
                    },
                    "run": { "id": "run-test-1" },
                }))
            }),
        )
        .route(
            "/v1/agents/{id}",
            axum::routing::get(|| async {
                axum::Json(serde_json::json!({
                    "id": "bc-test-agent",
                    "name": "Add a health check",
                    "url": "https://cursor.com/agents/bc-test-agent",
                }))
            }),
        )
        .route(
            "/v1/agents/{id}/archive",
            axum::routing::post(move |axum::extract::Path(id): axum::extract::Path<String>| {
                let archived = archived.clone();
                async move {
                    archived.lock().expect("log poisoned").push(id.clone());
                    axum::Json(serde_json::json!({ "id": id }))
                }
            }),
        )
        .route(
            "/v1/agents/{id}/runs/{run}/stream",
            axum::routing::get({
                let connects = Arc::new(Mutex::new(0usize));
                move || {
                    let connects = connects.clone();
                    async move {
                        // The first connects land in the window before Cursor
                        // has provisioned the run's stream, in both refusal
                        // shapes seen live: an outright 409, then a 200 whose
                        // only event is an error. The client must reconnect
                        // through both rather than fail the turn.
                        let attempt = {
                            let mut connects = connects.lock().expect("counter poisoned");
                            *connects += 1;
                            *connects
                        };
                        if attempt == 1 {
                            return (
                                axum::http::StatusCode::CONFLICT,
                                [(axum::http::header::CONTENT_TYPE, "application/json")],
                                r#"{"error":{"code":"stream_unavailable","message":"Run stream is no longer available"}}"#,
                            );
                        }
                        let body: &'static str = if attempt == 2 {
                            concat!(
                                "event: error\n",
                                "data: {\"code\":\"stream_unavailable\",\"message\":\"Run stream is no longer available\"}\n",
                                "\n",
                            )
                        } else {
                            concat!(
                                "event: status\n",
                                "data: {\"runId\":\"run-test-1\",\"status\":\"RUNNING\"}\n",
                                "\n",
                                "event: assistant\n",
                                "data: {\"text\":\"done\"}\n",
                                "\n",
                                "event: result\n",
                                "data: {\"runId\":\"run-test-1\",\"status\":\"FINISHED\",\"text\":\"done\"}\n",
                                "\n",
                                "event: done\n",
                                "data: {}\n",
                                "\n",
                            )
                        };
                        (
                            axum::http::StatusCode::OK,
                            [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                            body,
                        )
                    }
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let base_url = format!("http://{}", listener.local_addr().expect("addr"));
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    (base_url, archive_log)
}

/// A key source: `Some` for an owner who has connected Cursor, `None` for one
/// who has not — the state every user starts in.
#[derive(Clone, Copy)]
struct StubKeys(Option<&'static str>);

impl CursorApiKeys for StubKeys {
    async fn resolve(&self, _owner: &MacroUserIdStr<'_>) -> Result<CursorApiKey> {
        self.0
            .map(|key| CursorApiKey::parse(key).expect("a well-formed stub key"))
            .ok_or(HarnessError::CursorNotConnected)
    }
}

fn manager(
    base_url: String,
    sessions: StubSessions,
) -> CursorContainerManager<StubSessions, StubKeys> {
    manager_with_keys(base_url, sessions, StubKeys(Some("crsr_test")))
}

fn manager_with_keys(
    base_url: String,
    sessions: StubSessions,
    keys: StubKeys,
) -> CursorContainerManager<StubSessions, StubKeys> {
    let repo = CursorRepoUrl::parse("https://github.com/macro-inc/macro").expect("valid repo");
    CursorContainerManager::new(keys, base_url, repo, sessions)
}

async fn next_acp(
    receiver: &mut tokio::sync::mpsc::UnboundedReceiver<ToServerMessage>,
) -> serde_json::Value {
    loop {
        match receiver.recv().await.expect("a message") {
            ToServerMessage::Acp(AcpMessage(frame)) => {
                return serde_json::to_value(frame).expect("serializable");
            }
            _ => continue,
        }
    }
}

async fn send_acp(sender: &super::super::pipe::PipeSender, frame: serde_json::Value) {
    sender
        .send(ToRuntimeMessage::Acp(AcpMessage(
            serde_json::from_value(frame).expect("valid frame"),
        )))
        .await
        .expect("send");
}

/// The whole spawn path: initialize, open a session, prompt — and the minted
/// agent's identity lands in the external-session repo before the prompt
/// answers.
#[tokio::test]
async fn spawning_and_prompting_records_the_minted_agent() {
    let (base_url, _) = fake_cursor_api().await;
    let sessions = StubSessions::default();
    let session_id = AgentSessionId::new();
    let manager = manager(base_url, sessions.clone());

    let transport = manager
        .spawn(SpawnContainer {
            session_id,
            kind: AgentKind::Cursor,
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
            size: SandboxSize::Default,
        })
        .await
        .expect("spawn");
    let (sender, mut receiver) = transport.split();

    send_acp(
        &sender,
        serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
    )
    .await;
    let initialize = next_acp(&mut receiver).await;
    assert_eq!(
        initialize["result"]["agentCapabilities"]["loadSession"],
        true
    );

    send_acp(
        &sender,
        serde_json::json!({"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/workspace","mcpServers":[]}}),
    )
    .await;
    let opened = next_acp(&mut receiver).await;
    let acp_session = opened["result"]["sessionId"]
        .as_str()
        .expect("a session id");

    send_acp(
        &sender,
        serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{
            "sessionId": acp_session,
            "prompt": [{"type":"text","text":"add a health check"}],
        }}),
    )
    .await;
    // Updates stream first; the prompt's response ends the turn.
    let response = loop {
        let frame = next_acp(&mut receiver).await;
        if frame["id"] == 3 {
            break frame;
        }
    };
    assert_eq!(response["result"]["stopReason"], "end_turn");

    let recorded = ExternalSessionRepo::get(&sessions, session_id)
        .await
        .expect("get")
        .expect("row written");
    assert_eq!(recorded.provider, CURSOR_PROVIDER);
    assert_eq!(recorded.external_id, "bc-test-agent");
    assert_eq!(
        recorded.external_url.as_deref(),
        Some("https://cursor.com/agents/bc-test-agent")
    );
}

/// Resume restores the persisted identity: the harness's `session/load` is
/// answered, and the next prompt is a follow-up run on the restored agent —
/// not a fresh agent.
#[tokio::test]
async fn resume_restores_the_persisted_identity() {
    let (base_url, _) = fake_cursor_api().await;
    let sessions = StubSessions::default();
    let session_id = AgentSessionId::new();
    ExternalSessionRepo::upsert(
        &sessions,
        session_id,
        ExternalSession {
            provider: CURSOR_PROVIDER.to_owned(),
            external_id: "bc-restored".to_owned(),
            external_name: None,
            external_url: None,
        },
    )
    .await
    .expect("seed row");
    *sessions.acp_session_id.lock().expect("stub poisoned") = Some("cursor-acp-1".to_owned());
    let manager = manager(base_url, sessions.clone());

    let transport = manager.resume(session_id).await.expect("resume");
    let (sender, mut receiver) = transport.split();

    send_acp(
        &sender,
        serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
    )
    .await;
    next_acp(&mut receiver).await;
    send_acp(
        &sender,
        serde_json::json!({"jsonrpc":"2.0","id":2,"method":"session/load","params":{
            "sessionId":"cursor-acp-1","cwd":"/workspace","mcpServers":[]}}),
    )
    .await;
    let loaded = next_acp(&mut receiver).await;
    assert_eq!(loaded["id"], 2);
    assert!(loaded.get("error").is_none(), "got {loaded}");
}

/// A session that died between `session/new` and its first prompt has an
/// acp id but no external row. Resume must still answer its `session/load` —
/// refusing left a session every follow-up crashed against (seen live).
#[tokio::test]
async fn resume_answers_session_load_even_before_an_agent_was_minted() {
    let (base_url, _) = fake_cursor_api().await;
    let sessions = StubSessions::default();
    let session_id = AgentSessionId::new();
    *sessions.acp_session_id.lock().expect("stub poisoned") = Some("cursor-acp-1".to_owned());
    let manager = manager(base_url, sessions.clone());

    let transport = manager.resume(session_id).await.expect("resume");
    let (sender, mut receiver) = transport.split();

    send_acp(
        &sender,
        serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
    )
    .await;
    next_acp(&mut receiver).await;
    send_acp(
        &sender,
        serde_json::json!({"jsonrpc":"2.0","id":2,"method":"session/load","params":{
            "sessionId":"cursor-acp-1","cwd":"/workspace","mcpServers":[]}}),
    )
    .await;
    let loaded = next_acp(&mut receiver).await;
    assert!(loaded.get("error").is_none(), "got {loaded}");

    // The next prompt mints the agent and records it, like any first prompt.
    send_acp(
        &sender,
        serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{
            "sessionId": "cursor-acp-1",
            "prompt": [{"type":"text","text":"still there?"}],
        }}),
    )
    .await;
    loop {
        let frame = next_acp(&mut receiver).await;
        if frame["id"] == 3 {
            assert_eq!(frame["result"]["stopReason"], "end_turn", "got {frame}");
            break;
        }
    }
    assert!(
        ExternalSessionRepo::get(&sessions, session_id)
            .await
            .expect("get")
            .is_some(),
        "the newly minted agent must be recorded"
    );
}

/// A pipe nothing has moved through for the idle timeout is shut down —
/// Daytona's reaper made local. The harness side observes a clean end of
/// stream, which is what parks the session until its next prompt resumes it.
#[tokio::test(start_paused = true)]
async fn an_idle_pipe_is_shut_down() {
    // No fake API: nothing is called before the first prompt, and a live
    // TCP listener's pending io would hold tokio's paused clock back to
    // real time — five real minutes for one idle timeout.
    let manager = manager("http://127.0.0.1:1".to_owned(), StubSessions::default());

    let transport = manager
        .spawn(SpawnContainer {
            session_id: AgentSessionId::new(),
            kind: AgentKind::Cursor,
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
            size: SandboxSize::Default,
        })
        .await
        .expect("spawn");
    let (_sender, mut receiver) = transport.split();

    // The ready marker arrives; then nothing ever does, and after the idle
    // timeout (paused clock, so instantly) the stream ends instead of
    // holding its tasks and its cursor.com poll forever.
    assert!(receiver.recv().await.is_some(), "acp ready arrives");
    assert!(
        receiver.recv().await.is_none(),
        "an idle pipe must close, not hang"
    );
}

/// Teardown archives the agent on cursor.com and forgets the mapping; a
/// session that never minted an agent tears down without any API call.
#[tokio::test]
async fn teardown_archives_and_forgets() {
    let (base_url, archived) = fake_cursor_api().await;
    let sessions = StubSessions::default();
    let session_id = AgentSessionId::new();
    let manager = manager(base_url, sessions.clone());

    // Nothing minted: no API call, still Ok.
    manager.teardown(session_id).await.expect("no-op teardown");
    assert!(archived.lock().expect("log poisoned").is_empty());

    ExternalSessionRepo::upsert(
        &sessions,
        session_id,
        ExternalSession {
            provider: CURSOR_PROVIDER.to_owned(),
            external_id: "bc-doomed".to_owned(),
            external_name: None,
            external_url: None,
        },
    )
    .await
    .expect("seed row");
    manager.teardown(session_id).await.expect("teardown");
    assert_eq!(
        archived.lock().expect("log poisoned").as_slice(),
        ["bc-doomed"]
    );
    assert_eq!(
        ExternalSessionRepo::get(&sessions, session_id)
            .await
            .expect("get"),
        None
    );
}

/// An owner who has not connected Cursor gets a sentence they can act on, not
/// a generic provisioning failure — this is the first run of `@cursor` for
/// everyone, so it is the error most users will ever see.
#[tokio::test]
async fn spawning_without_a_registered_key_says_so() {
    let (base_url, _) = fake_cursor_api().await;
    let sessions = StubSessions::default();
    let manager = manager_with_keys(base_url, sessions, StubKeys(None));

    let refused = manager
        .spawn(SpawnContainer {
            session_id: AgentSessionId::new(),
            kind: AgentKind::Cursor,
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
            size: SandboxSize::Default,
        })
        .await
        // `err()` rather than `expect_err`: the success type is a live
        // transport, which has no `Debug` to print.
        .err()
        .expect("a session with no key must not open");

    assert!(
        matches!(refused, HarnessError::CursorNotConnected),
        "expected a connect-your-account error, got {refused:?}"
    );
}

/// Disconnecting Cursor and then tearing down a session it owns: the agent
/// cannot be archived without the key, but the session must still clean up.
/// The alternative is a Macro session nothing can ever remove.
#[tokio::test]
async fn teardown_forgets_the_session_even_when_the_key_is_gone() {
    let (base_url, archived) = fake_cursor_api().await;
    let sessions = StubSessions::default();
    let session_id = AgentSessionId::new();
    let manager = manager_with_keys(base_url, sessions.clone(), StubKeys(None));

    ExternalSessionRepo::upsert(
        &sessions,
        session_id,
        ExternalSession {
            provider: CURSOR_PROVIDER.to_owned(),
            external_id: "bc-orphaned".to_owned(),
            external_name: None,
            external_url: None,
        },
    )
    .await
    .expect("seed row");

    manager.teardown(session_id).await.expect("teardown");

    assert!(
        archived.lock().expect("log poisoned").is_empty(),
        "archiving is impossible without the owner's key"
    );
    assert_eq!(
        ExternalSessionRepo::get(&sessions, session_id)
            .await
            .expect("get"),
        None,
        "the row is ours to forget even when the agent is not ours to archive"
    );
}
