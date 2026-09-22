//! The complete worker socket path, including the real harness and session actor.

use super::*;
use agent_harness::{
    domain::{
        model::{
            AgentKind, AnnounceOrigin, HarnessDefaults, PermissionPolicyConfig, PriorMessage,
            SessionDefaults,
        },
        pending::PendingCommands,
        ports::{
            AgentPromptComposer, HarnessBindings, MessagePromptContext, NoPeers, NoPromptMentions,
            NoopAgentSessionNotifier, PermissionPolicySource,
        },
        service::AgentHarnessService,
    },
    outbound::runtime_registry::{HarnessKeyedConnections, RuntimeRegistry},
    testing::helpers::{
        announcer::AnnouncerMock,
        containers::{ContainerSender, MockContainerManager},
        egress::EgressProvisionerMock,
    },
};
use agent_inmem::domain::{
    engine::{TurnEngine, TurnRequest},
    mcp::NoMcpServers,
};
use agent_session::domain::ports::LateBoundTurnObserver;
use agent_voice::domain::{
    model::{LeaseState, Voice, WorkerIdentity},
    ports::{AgentVoiceDirectory, VoiceLeaseStore, VoiceMedia},
};
use macro_user_id::user_id::MacroUserIdStr;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message as ClientMessage, client::IntoClientRequest},
};

struct Edges;

impl HarnessBindings for Edges {
    async fn harness_for(&self, _: bot_id::BotId) -> anyhow::Result<Option<harness_id::HarnessId>> {
        Ok(None)
    }
}

impl PermissionPolicySource for Edges {
    async fn permission_policy(&self, _: bot_id::BotId) -> anyhow::Result<PermissionPolicyConfig> {
        Ok(PermissionPolicyConfig::Fixed(AgentKind::InMemory))
    }
}

impl MessagePromptContext for Edges {
    async fn authorize_origin(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &AnnounceOrigin,
    ) -> agent_harness::domain::error::Result<()> {
        Ok(())
    }
    async fn preceding_messages(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &AnnounceOrigin,
    ) -> agent_harness::domain::error::Result<Vec<PriorMessage>> {
        Ok(vec![])
    }
}

impl AgentPromptComposer for Edges {
    async fn compose(
        &self,
        text: &str,
        _: Option<&messages::domain::models::MessageParent>,
        _: Option<&[PriorMessage]>,
    ) -> agent_harness::domain::error::Result<String> {
        Ok(text.to_owned())
    }
}

impl TurnEngine for Edges {
    fn supported_models(&self) -> &[&str] {
        &[]
    }
    fn run_turn(
        &self,
        _: TurnRequest,
    ) -> tokio::sync::mpsc::Receiver<Result<agent::StreamPart, agent::AgentError>> {
        panic!("voice must never start the text model")
    }
}

#[async_trait::async_trait]
impl AgentVoiceDirectory for Edges {
    async fn is_macro_session(&self, _: Uuid) -> agent_voice::domain::model::Result<bool> {
        Ok(true)
    }
}

struct Store(Mutex<Option<VoiceLease>>);

#[async_trait::async_trait]
impl VoiceLeaseStore for Store {
    async fn claim(
        &self,
        lease: &VoiceLease,
    ) -> agent_voice::domain::model::Result<Option<VoiceLease>> {
        let mut current = self.0.lock().unwrap();
        if current.is_some() {
            return Ok(current.clone());
        }
        *current = Some(lease.clone());
        Ok(None)
    }
    async fn get(&self, _: Uuid) -> agent_voice::domain::model::Result<Option<VoiceLease>> {
        Ok(self.0.lock().unwrap().clone())
    }
    async fn transition(
        &self,
        _: Uuid,
        voice: VoiceSessionId,
        from: LeaseState,
        to: LeaseState,
    ) -> agent_voice::domain::model::Result<bool> {
        let mut current = self.0.lock().unwrap();
        let Some(lease) = current.as_mut() else {
            return Ok(false);
        };
        if lease.voice_session_id != voice || lease.state != from {
            return Ok(false);
        }
        lease.state = to;
        Ok(true)
    }
    async fn release(
        &self,
        _: Uuid,
        voice: VoiceSessionId,
    ) -> agent_voice::domain::model::Result<()> {
        let mut current = self.0.lock().unwrap();
        if current
            .as_ref()
            .is_some_and(|lease| lease.voice_session_id == voice)
        {
            *current = None;
        }
        Ok(())
    }
}

struct Media(VoiceLease);

#[async_trait::async_trait]
impl VoiceMedia for Media {
    async fn provision(&self, _: &VoiceLease) -> agent_voice::domain::model::Result<()> {
        Ok(())
    }
    async fn close(&self, _: &VoiceLease) -> agent_voice::domain::model::Result<()> {
        Ok(())
    }
    async fn is_open(&self, _: &VoiceLease) -> agent_voice::domain::model::Result<bool> {
        Ok(true)
    }
    fn token(&self, _: &VoiceLease, _: u32) -> agent_voice::domain::model::Result<String> {
        Ok("test".into())
    }
    fn url(&self) -> &str {
        "ws://unused.test"
    }
    fn verify_worker(&self, token: &str) -> agent_voice::domain::model::Result<WorkerIdentity> {
        if token != "socket-test-worker" {
            return test_media().verify_worker(token);
        }
        Ok(WorkerIdentity {
            identity: self.0.agent_identity(),
            room_name: self.0.room_name(),
        })
    }
}

fn test_media() -> agent_voice::outbound::livekit::LivekitVoiceMedia {
    agent_voice::outbound::livekit::LivekitVoiceMedia::new(
        "ws://unused.test",
        "socket-test-key".into(),
        "socket-test-secret-at-least-32-characters".into(),
        "http://unused.test",
        "macro-agent-voice-test".into(),
    )
    .unwrap()
}

struct Factory(Arc<Tools>);

#[async_trait::async_trait]
impl WorkerToolFactory for Factory {
    async fn prepare(
        &self,
        _: &VoiceLease,
        _: Vec<McpServer>,
        _: UnboundedSender<ToServerMessage>,
        _: CancellationToken,
    ) -> anyhow::Result<Arc<dyn WorkerToolSession>> {
        Ok(self.0.clone())
    }
}

async fn exercise_worker_socket(resuming: bool, python: bool) {
    let repo = InMemoryAgentSessionRepo::new();
    let id = AgentSessionId::new();
    let mut row = test_agent_session(id);
    row.bot_id = bot_id::MACRO_NEW_BOT_ID;
    row.harness = "in-memory".into();
    if resuming {
        row.acp_session_id = Some(agent_client_protocol::schema::v1::SessionId::new(
            "existing-macro-session",
        ));
    }
    let lease = VoiceLease {
        session_id: id.as_uuid(),
        voice_session_id: VoiceSessionId(macro_uuid::generate_uuid_v7()),
        owner: row.owner_user().unwrap().clone(),
        client_session_id: macro_uuid::generate_uuid_v7(),
        voice: Voice::Marin,
        expires_at: (std::time::SystemTime::now() + std::time::Duration::from_secs(300)).into(),
        state: LeaseState::Active,
    };
    repo.insert_session(row);
    let observer = Arc::new(LateBoundTurnObserver::new());
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        observer.clone(),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );
    let egress = EgressProvisionerMock::new();
    let registry = Arc::new(VoiceRuntimeRegistry::new(
        sessions.clone(),
        egress.clone(),
        Arc::new(InMemAgentManager::new(
            Arc::new(Edges),
            Arc::new(agent_inmem::outbound::log_frames::LogFrameSource::new(repo)),
            Arc::new(NoMcpServers),
        )),
    ));
    let store = Arc::new(Store(Mutex::new(Some(lease.clone()))));
    registry.bind_service(AgentVoiceService::new(
        Arc::new(Edges),
        store.clone(),
        Arc::new(Media(lease.clone())),
        registry.clone(),
    ));
    let harness = AgentHarnessService::new(
        sessions.clone(),
        MockContainerManager::new(),
        AnnouncerMock::new(),
        HarnessKeyedConnections::new(Edges, RuntimeRegistry::<ContainerSender>::new()),
        Edges,
        Edges,
        EgressProvisionerMock::new(),
        NoPeers,
        Edges,
        HarnessDefaults::new(SessionDefaults {
            bot_id: bot_id::MACRO_NEW_BOT_ID,
            model: "test".into(),
            harness: "in-memory".into(),
            repo_url: None,
        }),
        NoopLifecyclePublisher,
        PendingCommands::new(),
        NoPromptMentions,
        NoopAgentSessionNotifier,
    )
    .with_voice_runtime(registry.clone());
    observer.bind(harness.clone());
    let tools = Arc::new(Tools::default());
    registry.bind_harness(Arc::new(harness), Arc::new(Factory(tools.clone())));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = Router::new().nest("/agent-sessions", worker_router(registry));
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let endpoint = format!(
        "ws://{address}/agent-sessions/{id}/voice/{}/runtime",
        lease.voice_session_id.0
    );
    check_availability(address, &lease, &sessions, &egress).await;
    if python {
        tools.finish.notify_one();
        let metadata = agent_voice::domain::model::DispatchMetadata::from(&lease);
        let mut metadata = serde_json::to_value(metadata).unwrap();
        metadata["runtimeUrl"] = json!(endpoint);
        let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../agent_voice")
            .canonicalize()
            .unwrap();
        let output = tokio::process::Command::new("docker")
            .args([
                "run",
                "--rm",
                "--network=host",
                "-v",
                &format!("{}:/voice-source:ro", directory.display()),
                "--workdir",
                "/voice-source",
                "--entrypoint",
                "python",
                "macro-agent-voice-local",
                "tests/native_runtime_socket_smoke.py",
                &metadata.to_string(),
            ])
            .output()
            .await
            .unwrap();
        assert!(
            output.status.success(),
            "Python worker failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("native runtime socket passed"));
    } else {
        drive_worker_socket(endpoint, resuming, &tools).await;
    }
    while store.0.lock().unwrap().is_some() {
        tokio::task::yield_now().await;
    }
    let log = sessions.session_log(id).await.unwrap();
    let frames: Vec<_> = log
        .entries
        .into_iter()
        .map(|entry| serde_json::to_value(entry.entry.content).unwrap())
        .collect();
    assert_eq!(
        frames
            .iter()
            .filter(|frame| frame["content"]["method"] == "session/prompt")
            .count(),
        1
    );
    assert!(
        frames
            .iter()
            .any(|frame| frame["content"]["params"]["update"]["status"] == "completed")
    );
    sessions.shutdown().await;
    server.abort();
}

async fn drive_worker_socket(endpoint: String, resuming: bool, tools: &Tools) {
    let mut request = endpoint.into_client_request().unwrap();
    request.headers_mut().insert(
        "authorization",
        "Bearer socket-test-worker".parse().unwrap(),
    );
    let (mut client, _) = connect_async(request).await.unwrap();

    // NativeRuntime.connect receives configure before emitting acp_ready.
    let configuration: Value =
        serde_json::from_str(client.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(configuration["type"], "configure");
    let session_id = configuration["sessionId"].clone();
    client
        .send(ClientMessage::Text(
            json!({"type":"event","event":"acp_ready"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    for stage in [
        "initialize",
        if resuming {
            "session/resume"
        } else {
            "session/new"
        },
    ] {
        let frame: Value =
            serde_json::from_str(client.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(frame["method"], stage);
        let result = if stage == "initialize" {
            json!({"protocolVersion":1,"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{}}},"agentInfo":{"name":"macro-voice","version":"1"}})
        } else {
            json!({"sessionId":session_id})
        };
        client
            .send(ClientMessage::Text(
                json!({"type":"acp","jsonrpc":"2.0","id":frame["id"],"result":result})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
    }
    let action = AgentActionId::mint();
    client
        .send(ClientMessage::Text(
            json!({"type":"nativeTurn","actionId":action,"text":"Read my document"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let admission: Value =
        serde_json::from_str(client.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(admission["type"], "nativeTurnAccepted");
    tools.finish.notify_one();
    client.send(ClientMessage::Text(json!({"type":"toolCall","actionId":action,"callId":"read-1","name":"ReadDocument","arguments":{}}).to_string().into())).await.unwrap();
    let result: Value =
        serde_json::from_str(client.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(result["type"], "toolResult");
    assert_eq!(tools.calls.load(Ordering::SeqCst), 1);
    client
        .send(ClientMessage::Text(
            json!({"type":"acp","jsonrpc":"2.0","id":action,"result":{"stopReason":"end_turn"}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    client.close(None).await.unwrap();
}

async fn check_availability(
    address: std::net::SocketAddr,
    lease: &VoiceLease,
    sessions: &Sessions,
    egress: &EgressProvisionerMock,
) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let browser = test_media().token(lease, 300).unwrap();
    for (voice, token, expected) in [
        (lease.voice_session_id.0, "socket-test-worker", "204"),
        (macro_uuid::generate_uuid_v7(), "socket-test-worker", "401"),
        (lease.voice_session_id.0, browser.as_str(), "401"),
        (lease.voice_session_id.0, "invalid", "401"),
    ] {
        let mut connection = tokio::net::TcpStream::connect(address).await.unwrap();
        let request = format!(
            "GET /agent-sessions/{}/voice/{voice}/runtime/availability HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n",
            lease.session_id
        );
        connection.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        connection.read_to_string(&mut response).await.unwrap();
        assert!(
            response.starts_with(&format!("HTTP/1.1 {expected}")),
            "{response}"
        );
    }
    assert!(matches!(
        sessions
            .management(AgentSessionId::new_from_uuid(lease.session_id))
            .await
            .unwrap(),
        agent_session::domain::model::SessionManagement::Unmanaged
    ));
    assert!(
        egress.provisioned().is_empty(),
        "an availability probe must not rotate the session token"
    );
}

#[tokio::test]
async fn real_worker_socket_bootstraps_records_audio_and_completes_native_tools() {
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        exercise_worker_socket(false, false),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn real_worker_socket_resumes_an_existing_macro_conversation() {
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        exercise_worker_socket(true, false),
    )
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "requires the local macro-agent-voice-local SDK image; no provider or media calls"]
async fn python_native_runtime_connects_to_real_rust_harness() {
    for resuming in [false, true] {
        tokio::time::timeout(
            std::time::Duration::from_secs(20),
            exercise_worker_socket(resuming, true),
        )
        .await
        .unwrap();
    }
}
