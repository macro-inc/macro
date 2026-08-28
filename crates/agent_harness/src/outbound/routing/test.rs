use super::*;
use crate::domain::sandbox::SandboxResizeEffect;
use crate::testing::helpers::egress::test_egress;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::error::Result as SessionResult;
use agent_session::domain::model::{
    AgentSession, ChannelSession, CreateAgentSessionParams, DEFAULT_AGENT_SESSION_NAME,
    SandboxSize, SessionBot, SessionStatus,
};
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// A transport that only exists to be told apart from the other provider's.
struct TaggedTransport;

impl Transport<ToRuntimeMessage, ToServerMessage> for TaggedTransport {
    type Sender = mpsc::UnboundedSender<ToRuntimeMessage>;
    type Receiver = mpsc::UnboundedReceiver<ToServerMessage>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        let (sender, _) = mpsc::unbounded_channel();
        let (_, receiver) = mpsc::unbounded_channel();
        (sender, receiver)
    }
}

/// Records which provider each call landed on.
#[derive(Clone)]
struct TaggedManager {
    tag: &'static str,
    calls: Arc<Mutex<Vec<String>>>,
}

impl TaggedManager {
    fn new(tag: &'static str) -> Self {
        Self {
            tag,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("calls poisoned").clone()
    }

    fn record(&self, operation: &str) {
        self.calls
            .lock()
            .expect("calls poisoned")
            .push(format!("{}:{operation}", self.tag));
    }
}

impl ContainerManager for TaggedManager {
    type Transport = TaggedTransport;

    async fn spawn(&self, _command: SpawnContainer) -> Result<TaggedTransport> {
        self.record("spawn");
        Ok(TaggedTransport)
    }

    async fn resume(&self, _session: AgentSessionId) -> Result<TaggedTransport> {
        self.record("resume");
        Ok(TaggedTransport)
    }

    async fn session_token(&self, _session: AgentSessionId) -> Result<Option<String>> {
        self.record("session_token");
        Ok(None)
    }

    async fn teardown(&self, _session: AgentSessionId) -> Result<()> {
        self.record("teardown");
        Ok(())
    }

    fn resize_effect(&self, _from: SandboxSize, _to: SandboxSize) -> SandboxResizeEffect {
        unimplemented!("these tests never resize")
    }

    async fn resize(&self, _session: AgentSessionId, _size: SandboxSize) -> Result<()> {
        unimplemented!("these tests never resize")
    }
}

/// Answers every session lookup with a fixed bot.
#[derive(Clone)]
struct FixedBotSessions(BotId);

impl AgentSessionRepo for FixedBotSessions {
    async fn create(&self, _params: CreateAgentSessionParams) -> SessionResult<AgentSession> {
        unimplemented!("the router never creates sessions")
    }

    async fn find_by_egress_token_hash(
        &self,
        _egress_token_hash: &str,
    ) -> SessionResult<Option<AgentSession>> {
        unimplemented!("the router never looks sessions up by egress token")
    }

    async fn get(&self, id: AgentSessionId) -> SessionResult<AgentSession> {
        Ok(AgentSession {
            id,
            owner_id: MacroUserIdStr::try_from("macro|owner@macro.com".to_owned())
                .expect("valid user id"),
            thread_id: None,
            thread_channel_id: None,
            originating_message_id: None,
            bot_id: self.0,
            model: "auto".to_owned(),
            harness: "cursor".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            name: DEFAULT_AGENT_SESSION_NAME.to_owned(),
            sandbox_size: SandboxSize::Default,
            instructions: None,
            acp_session_id: None,
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
        unimplemented!("the router never routes channel events")
    }

    async fn find_all_for_thread(
        &self,
        _thread_id: macro_uuid::Uuid,
    ) -> SessionResult<Vec<AgentSession>> {
        unimplemented!("the router never lists thread sessions")
    }

    async fn session_bot(&self, _id: BotId) -> SessionResult<SessionBot> {
        unimplemented!("the router never renders bots")
    }

    async fn set_acp_session_id(
        &self,
        _id: AgentSessionId,
        _acp_session_id: agent_client_protocol::schema::v1::SessionId,
    ) -> SessionResult<()> {
        unimplemented!("the router never persists acp ids")
    }

    async fn set_model(&self, _id: AgentSessionId, _model: &str) -> SessionResult<()> {
        unimplemented!("the router never sets models")
    }

    async fn delete(&self, _id: AgentSessionId) -> SessionResult<()> {
        unimplemented!("the router never deletes sessions")
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

fn spawn_for(kind: AgentKind) -> SpawnContainer {
    SpawnContainer {
        session_id: AgentSessionId::new(),
        kind,
        size: SandboxSize::Default,
        egress: test_egress(),
    }
}

#[tokio::test]
async fn the_cursor_bot_routes_to_cursor_and_everything_else_to_the_sandbox() {
    let sandbox = TaggedManager::new("sandbox");
    let cursor = TaggedManager::new("cursor");
    let router = RoutedContainerManager::new(
        sandbox.clone(),
        cursor.clone(),
        FixedBotSessions(bot_id::CURSOR_BOT_ID),
    );

    let spawned = router
        .spawn(spawn_for(AgentKind::Cursor))
        .await
        .expect("spawn");
    assert!(matches!(spawned, RoutedTransport::Cursor(_)));
    let spawned = router
        .spawn(spawn_for(AgentKind::SandboxedCoder))
        .await
        .expect("spawn");
    assert!(matches!(spawned, RoutedTransport::Sandbox(_)));
    assert_eq!(cursor.calls(), ["cursor:spawn"]);
    assert_eq!(sandbox.calls(), ["sandbox:spawn"]);
}

/// Resume and teardown route by the session row's bot — the repo says cursor
/// here, so the sandbox provider must never hear about the session.
#[tokio::test]
async fn resume_and_teardown_route_by_the_stored_bot() {
    let sandbox = TaggedManager::new("sandbox");
    let cursor = TaggedManager::new("cursor");
    let router = RoutedContainerManager::new(
        sandbox.clone(),
        cursor.clone(),
        FixedBotSessions(bot_id::CURSOR_BOT_ID),
    );

    let session = AgentSessionId::new();
    router.resume(session).await.expect("resume");
    router.teardown(session).await.expect("teardown");
    assert_eq!(cursor.calls(), ["cursor:resume", "cursor:teardown"]);
    assert!(sandbox.calls().is_empty());
}
