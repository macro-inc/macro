//! Integration tests: the real orchestrator over the real session service,
//! with in-memory persistence, mock containers, a fake agent, and a
//! recording announcer. Only the edges are doubles.

mod user_cleanup;

use messages::domain::models::MessageParent;
use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{
    AgentCapabilities, ClientNotification, ClientRequest, ContentBlock, InitializeResponse,
    NewSessionResponse, PermissionOption, PermissionOptionKind, RequestId,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse, Response,
    ResumeSessionResponse, SelectedPermissionOutcome, SessionCapabilities, SessionId,
    SessionResumeCapabilities, ToolCallUpdate, ToolCallUpdateFields,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use agent_fold::domain::model::TurnSignal;
use agent_fold::domain::model::{AuthorKind, MessageId};
use agent_fold::domain::service::FoldedMessageService;
use agent_runtime_protocol::domain::{
    action::{AgentAction, AgentActionId, AgentPermissionAction, PermissionAnswer},
    schema::v0::{AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage},
};
use agent_session::PROTOCOL_VERSION;
use agent_session::domain::events::AgentSessionLifecycleEvent;
use agent_session::domain::model::{
    AgentMcpServers, AgentSessionId, CreateAgentSessionParams, Message, SandboxSize,
};
use agent_session::domain::ports::{
    AgentSessionLogRepo as _, AgentSessionNotificationRecipient as _, AgentSessionRepo as _,
    ControlEvent, NoOpRealtime, NoopLifecyclePublisher,
};
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::domain::session::StopReason;
use agent_session::testing::{InMemoryAgentSessionRepo, RecordingLifecyclePublisher};
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use tokio::sync::mpsc;

use super::AgentHarnessService;
use super::into_session_error;
use crate::domain::error::HarnessError;
use crate::domain::model::{
    AgentKind, AgentRuntimeConfig, AnnounceOrigin, CommandOutcome, CommentAnchor,
    ConversationContext, DeclinedMention, DeliverAction, HarnessCommand, HarnessDefaults,
    MentionOrigin, OpenSession, PriorMessage, SessionBlocker, SessionDefaults, SessionRepository,
    SpawnContainer,
};
use crate::domain::ports::{
    AgentPromptComposer, ContainerManager as _, MessagePromptContext, NoPeers,
};
use crate::outbound::runtime_registry::RuntimeRegistry;
use crate::testing::helpers::agent::FakeAgent;
use crate::testing::helpers::announcer::AnnouncerMock;
use crate::testing::helpers::containers::{ContainerMock, ContainerSender, MockContainerManager};
use crate::testing::helpers::egress::{EgressProvisionerMock, test_egress};
use crate::testing::helpers::mentions::PromptMentionsMock;
use crate::testing::helpers::notifier::NotifierMock;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::ReplicaId;
use agent_session::domain::ports::{NoOpAgentSessionNameGenerator, NoOpTurnObserver};
use agent_session::domain::ports::{
    OpenExternalAgentSession, OpenManagedSession, SessionOpener as _,
};

fn sender() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("asker@example.com").expect("a valid user id")
}

#[test]
fn disconnected_harness_errors_keep_the_session_error_classification() {
    assert!(matches!(
        into_session_error(HarnessError::Disconnected(AgentSessionId::TEST_A)),
        AgentSessionError::Disconnected(AgentSessionId::TEST_A)
    ));
}

/// A sender whose email domain is `is_macro_staff` - the identity the
/// Daytona staff gate admits.
fn staff_sender() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("staff@macro.com").expect("a valid user id")
}

fn open_command() -> OpenSession {
    let thread_id = macro_uuid::generate_uuid_v7();
    OpenSession {
        bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        runtime: AgentRuntimeConfig {
            kind: AgentKind::SandboxedCoder,
            model: "agent-model".to_owned(),
            harness: "opencode".to_owned(),
            instructions: String::new(),
            mcp_servers: AgentMcpServers::OwnerConnections,
        },
        origin: MentionOrigin {
            parent: MessageParent::Channel(macro_uuid::generate_uuid_v7()),
            thread_id,
            message_id: thread_id,
            sender: sender(),
            content: "@claude fix the failing test".to_owned(),
            attachments: vec![],
        },
    }
}

/// A prompt arriving from a channel that is not the session's own, so it is
/// the announcing case.
fn forward_message(content: &str) -> DeliverAction {
    // Staff: `disconnected_session` is a Daytona coder bot, and the
    // execute() gate admits only macro.com actors onto those.
    DeliverAction::prompt(
        AgentAction::prompt(content),
        Some(staff_sender()),
        Some(AnnounceOrigin {
            parent: MessageParent::Channel(macro_uuid::Uuid::from_u128(0xf0)),
            thread_id: macro_uuid::Uuid::from_u128(0xf1),
            message_id: macro_uuid::Uuid::from_u128(0xf2),
        }),
    )
}

#[derive(Clone, Default)]
struct PromptContextMock {
    context: Arc<Mutex<ConversationContext>>,
    failure: Arc<Mutex<Option<String>>>,
    unauthorized: Arc<Mutex<Option<String>>>,
    authorized: Arc<Mutex<Vec<(MacroUserIdStr<'static>, AnnounceOrigin)>>>,
}

impl PromptContextMock {
    fn with_messages(messages: Vec<PriorMessage>) -> Self {
        Self::with_context(ConversationContext {
            anchor: None,
            messages,
        })
    }

    fn with_context(context: ConversationContext) -> Self {
        Self {
            context: Arc::new(Mutex::new(context)),
            ..Self::default()
        }
    }

    fn failing(message: &str) -> Self {
        Self {
            failure: Arc::new(Mutex::new(Some(message.to_owned()))),
            ..Self::default()
        }
    }

    fn unauthorized(message: &str) -> Self {
        Self {
            unauthorized: Arc::new(Mutex::new(Some(message.to_owned()))),
            ..Self::default()
        }
    }

    fn authorized(&self) -> Vec<(MacroUserIdStr<'static>, AnnounceOrigin)> {
        self.authorized.lock().unwrap().clone()
    }
}

impl MessagePromptContext for PromptContextMock {
    async fn authorize_origin(
        &self,
        actor: &MacroUserIdStr<'static>,
        origin: &AnnounceOrigin,
    ) -> crate::domain::error::Result<()> {
        if let Some(message) = self.unauthorized.lock().unwrap().clone() {
            return Err(HarnessError::PromptContext(rootcause::report!("{message}")));
        }
        self.authorized
            .lock()
            .unwrap()
            .push((actor.clone(), origin.clone()));
        Ok(())
    }

    async fn conversation_context(
        &self,
        _actor: &MacroUserIdStr<'static>,
        _origin: &AnnounceOrigin,
    ) -> crate::domain::error::Result<ConversationContext> {
        if let Some(message) = self.failure.lock().unwrap().clone() {
            return Err(HarnessError::PromptContext(rootcause::report!("{message}")));
        }
        Ok(self.context.lock().unwrap().clone())
    }
}

type PromptCompositionCall = (String, Option<ConversationContext>);

#[derive(Clone, Default)]
struct PromptComposerMock {
    calls: Arc<Mutex<Vec<PromptCompositionCall>>>,
    failure: Arc<Mutex<Option<String>>>,
}

impl PromptComposerMock {
    fn failing(message: &str) -> Self {
        Self {
            calls: Arc::default(),
            failure: Arc::new(Mutex::new(Some(message.to_owned()))),
        }
    }

    fn calls(&self) -> Vec<PromptCompositionCall> {
        self.calls.lock().unwrap().clone()
    }
}

impl AgentPromptComposer for PromptComposerMock {
    async fn compose(
        &self,
        prompt_markdown: &str,
        _parent: Option<&MessageParent>,
        context: Option<&ConversationContext>,
    ) -> crate::domain::error::Result<String> {
        self.calls
            .lock()
            .unwrap()
            .push((prompt_markdown.to_owned(), context.cloned()));
        if let Some(message) = self.failure.lock().unwrap().clone() {
            return Err(HarnessError::PromptComposition(rootcause::report!(
                "{message}"
            )));
        }
        Ok(if context.is_some() {
            context_prompt(prompt_markdown)
        } else {
            prompt_markdown.to_owned()
        })
    }
}

/// The orchestrator under test, over the session service it really uses.
type TestHarness = AgentHarnessService<
    AgentSessionServiceImpl<
        InMemoryAgentSessionRepo,
        FoldedMessageService<InMemoryAgentSessionRepo>,
        NoOpRealtime,
    >,
    MockContainerManager,
    AnnouncerMock,
    TestConnections,
    PromptContextMock,
    PromptComposerMock,
    EgressProvisionerMock,
    RecordingLifecyclePublisher,
    PromptMentionsMock,
    NotifierMock,
>;

/// Bot-to-harness bindings for tests: every bot maps to the harness sharing
/// its uuid, so tests attach runtimes by [`harness_for_bot`].
#[derive(Clone, Default)]
struct MirrorBindings;

impl crate::domain::ports::HarnessBindings for MirrorBindings {
    async fn harness_for(&self, bot: BotId) -> anyhow::Result<Option<harness_id::HarnessId>> {
        Ok(Some(harness_for_bot(bot)))
    }
}

/// No agent has said anything about permissions: every bot runs under its
/// kind's default.
struct KindDefaultPolicies;

impl crate::domain::ports::PermissionPolicySource for KindDefaultPolicies {
    async fn permission_policy(
        &self,
        bot: BotId,
    ) -> anyhow::Result<crate::domain::model::PermissionPolicyConfig> {
        Ok(crate::domain::model::PermissionPolicyConfig::Fixed(
            AgentKind::of(bot),
        ))
    }
}

fn harness_for_bot(bot: BotId) -> harness_id::HarnessId {
    harness_id::HarnessId::new_from_uuid(bot.as_uuid())
}

type TestConnections =
    crate::outbound::runtime_registry::HarnessKeyedConnections<MirrorBindings, ContainerSender>;

/// Forwards turn events to the harness, then reports them to the test.
///
/// The order is the point: `turn_ended` admits the harness's internal
/// `TurnEnded` command onto the session's FIFO worker *synchronously*, so by
/// the time the test hears the signal, anything it does next is admitted -
/// and therefore executed - after the turn end. That is what lets a test
/// answer a prompt and then act on an idle session without polling.
struct SignallingTurnObserver {
    harness: TestHarness,
    ended: mpsc::UnboundedSender<AgentSessionId>,
}

impl agent_session::domain::ports::SessionTurnObserver for SignallingTurnObserver {
    fn signal(&self, id: AgentSessionId, signal: TurnSignal) {
        let ended = matches!(signal, TurnSignal::TurnEnded { .. });
        agent_session::domain::ports::SessionTurnObserver::signal(&self.harness, id, signal);
        if ended {
            let _ = self.ended.send(id);
        }
    }

    fn session_stopped(&self, id: AgentSessionId, reason: StopReason) {
        agent_session::domain::ports::SessionTurnObserver::session_stopped(
            &self.harness,
            id,
            reason,
        );
    }
}

/// The test's half of [`SignallingTurnObserver`], plus the lifecycle facts
/// the harness and its session service published.
struct TurnSignals {
    ended: mpsc::UnboundedReceiver<AgentSessionId>,
    lifecycle: RecordingLifecyclePublisher,
    notifier: NotifierMock,
}

impl TurnSignals {
    /// Every lifecycle event published so far, in order.
    fn lifecycle(&self) -> Vec<AgentSessionLifecycleEvent> {
        self.lifecycle.published()
    }

    /// Wait until at least `count` lifecycle events have been published.
    async fn lifecycle_published(&self, count: usize) {
        self.lifecycle.wait_for_published(count).await;
    }
}

impl TurnSignals {
    /// Wait until `id`'s running turn has ended *and* the harness has been
    /// told - after this, the session is idle and the next turn-occupying
    /// action dispatches instead of queueing.
    async fn settled(&mut self, id: AgentSessionId) {
        loop {
            let ended = self
                .ended
                .recv()
                .await
                .expect("the turn observer outlives the test");
            if ended == id {
                return;
            }
        }
    }
}

/// Everything a test drives: the service under test and its edges.
type TestBench = (
    TestHarness,
    InMemoryAgentSessionRepo,
    MockContainerManager,
    AnnouncerMock,
    Arc<RuntimeRegistry<ContainerSender>>,
);

fn harness_with_signals(
    prompt_context: PromptContextMock,
    prompt_composer: PromptComposerMock,
) -> (TestBench, TurnSignals) {
    harness_with_mentions(prompt_context, prompt_composer, PromptMentionsMock::new())
}

fn harness_with_mentions(
    prompt_context: PromptContextMock,
    prompt_composer: PromptComposerMock,
    mentions: PromptMentionsMock,
) -> (TestBench, TurnSignals) {
    harness_with_policies_and_mentions(
        prompt_context,
        prompt_composer,
        KindDefaultPolicies,
        mentions,
    )
}

fn harness_with_policy(
    prompt_context: PromptContextMock,
    prompt_composer: PromptComposerMock,
    permission_policies: impl crate::domain::ports::PermissionPolicySource,
) -> (TestBench, TurnSignals) {
    harness_with_policies_and_mentions(
        prompt_context,
        prompt_composer,
        permission_policies,
        PromptMentionsMock::new(),
    )
}

fn harness_with_policies_and_mentions(
    prompt_context: PromptContextMock,
    prompt_composer: PromptComposerMock,
    permission_policies: impl crate::domain::ports::PermissionPolicySource,
    mentions: PromptMentionsMock,
) -> (TestBench, TurnSignals) {
    let repo = InMemoryAgentSessionRepo::new();
    let containers = MockContainerManager::new();
    let announcer = AnnouncerMock::new();
    let runtimes = RuntimeRegistry::new();
    // Same knot as production wiring: the harness is built from the session
    // service and is also its turn observer, so the observer binds late.
    let turn_observer = Arc::new(agent_session::domain::ports::LateBoundTurnObserver::new());
    // One recorder for both publishers, as in production: renames come from
    // the session service, everything else from the harness.
    let lifecycle = RecordingLifecyclePublisher::new();
    let notifier = NotifierMock::new();
    let service = AgentHarnessService::new(
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            turn_observer.clone(),
            Arc::new(lifecycle.clone()),
            ReplicaId::mint(),
        ),
        containers.clone(),
        announcer.clone(),
        TestConnections::new(MirrorBindings, Arc::clone(&runtimes)),
        prompt_context,
        prompt_composer,
        EgressProvisionerMock::new(),
        NoPeers,
        permission_policies,
        HarnessDefaults::new(SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: SessionRepository::parse("https://github.com/macro-inc/macro"),
        })
        .with_bot(
            bot_id::CODEX_BOT_ID,
            SessionDefaults {
                bot_id: bot_id::CODEX_BOT_ID,
                model: String::new(),
                harness: "codex-cloud".into(),
                repo_url: None,
            },
        ),
        lifecycle.clone(),
        crate::domain::pending::PendingCommands::new(),
        mentions,
        notifier.clone(),
    );
    let (ended, ended_rx) = mpsc::unbounded_channel();
    turn_observer.bind(SignallingTurnObserver {
        harness: service.clone(),
        ended,
    });
    (
        (service, repo, containers, announcer, runtimes),
        TurnSignals {
            ended: ended_rx,
            lifecycle,
            notifier,
        },
    )
}

fn harness_with_edges(
    prompt_context: PromptContextMock,
    prompt_composer: PromptComposerMock,
) -> TestBench {
    // Dropping the receiver is fine: sends to a closed channel are ignored,
    // and a test that never waits on turns does not need the signal.
    let (bench, _signals) = harness_with_signals(prompt_context, prompt_composer);
    bench
}

fn harness_with_context(prompt_context: PromptContextMock) -> TestBench {
    harness_with_edges(prompt_context, PromptComposerMock::default())
}

fn harness() -> TestBench {
    harness_with_context(PromptContextMock::default())
}

fn context_prompt(original: &str) -> String {
    format!("composed: {original}")
}

/// Play the agent's half of the ACP handshake.
async fn complete_session_handshake(container: &ContainerMock) {
    let agent = container.agent();
    let already = agent.received_requests().len();
    container.sends_ready();
    agent.wait_for_requests(already + 1).await;
    agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
    agent.wait_for_requests(already + 2).await;
    agent.opens_session(NewSessionResponse::new("acp-test"));
}

async fn complete_handshake(container: &ContainerMock) {
    complete_session_handshake(container).await;
    let agent = container.agent();
    agent.completes_prompt().await;
}

async fn complete_resume(container: &ContainerMock) {
    let agent = container.agent();
    container.sends_ready();
    agent.wait_for_requests(1).await;
    agent.completes_initialize(
        InitializeResponse::new(PROTOCOL_VERSION).agent_capabilities(
            AgentCapabilities::new().session_capabilities(
                SessionCapabilities::new().resume(SessionResumeCapabilities::new()),
            ),
        ),
    );
    agent.wait_for_requests(2).await;
    assert!(matches!(
        &agent.received_requests()[1],
        ClientRequest::ResumeSessionRequest(request) if request.session_id.to_string() == "acp-test"
    ));
    agent.resumes_session(ResumeSessionResponse::new());
    agent.completes_prompt().await;
}

fn prompts(agent: &FakeAgent) -> Vec<Vec<ContentBlock>> {
    agent
        .received_requests()
        .into_iter()
        .filter_map(|request| match request {
            ClientRequest::PromptRequest(prompt) => Some(prompt.prompt),
            _ => None,
        })
        .collect()
}

async fn disconnected_session(
    repo: &InMemoryAgentSessionRepo,
    containers: &MockContainerManager,
) -> AgentSessionId {
    let OpenSession { origin, .. } = open_command();
    disconnected_session_owned_by(repo, containers, model_owner::Owner::User(origin.sender)).await
}

/// [`disconnected_session`] for an arbitrary owner: the in-memory repo stores
/// whatever it is handed, so a bot-owned row exists to probe the paths that
/// need a user.
async fn disconnected_session_owned_by(
    repo: &InMemoryAgentSessionRepo,
    containers: &MockContainerManager,
    owner: model_owner::Owner,
) -> AgentSessionId {
    let OpenSession { origin, .. } = open_command();
    // The coder bot: resume-on-disconnect only exists for managed sessions.
    let bot_id = bot_id::MACRO_CODER_BOT_ID;
    let id = AgentSessionId::new();
    agent_session::domain::ports::AgentSessionRepo::create(
        repo,
        CreateAgentSessionParams {
            repo_branch: None,
            id,
            owner_id: owner,
            bot_id,
            thread_id: Some(origin.thread_id),
            originating_message_id: Some(origin.message_id),
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: Some("https://github.com/macro-inc/macro".to_owned()),
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
            egress_token_hash: None,
        },
    )
    .await
    .expect("the disconnected session should persist");
    repo.set_acp_session_id(id, SessionId::new("acp-test"))
        .await
        .expect("the ACP session id should persist");
    containers
        .spawn(SpawnContainer {
            session_id: id,
            kind: AgentKind::SandboxedCoder,
            size: agent_session::domain::model::SandboxSize::Default,
            egress: test_egress(),
        })
        .await
        .expect("the original sandbox should exist");
    id
}

#[tokio::test]
async fn open_creates_announces_and_delivers_the_mention() {
    let (service, repo, containers, announcer, _runtimes) = harness();
    let command = open_command();
    let id = AgentSessionId::new();
    let origin = command.origin.clone();

    let open = service.execute(id, HarnessCommand::Open(command));
    let drive = async {
        // The container exists as soon as `open` spawns it; drive its agent
        // through the handshake so the queued mention can flush.
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(&containers))
            .expect("the spawned container is findable");
        complete_handshake(&container).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.expect("open should succeed");

    // The row exists, carries the origin, and was announced into it.
    let session = repo.get(id).await.expect("the session row exists");
    assert_eq!(session.acp_session_id, Some(SessionId::new("acp-test")));
    assert_eq!(session.originating_message_id, Some(origin.message_id));
    assert_eq!(session.thread_id, Some(origin.thread_id));
    assert_eq!(session.model, "agent-model");
    assert_eq!(session.harness, "opencode");
    let announced = announcer.announced();
    assert_eq!(announced.len(), 1);
    assert_eq!(announced[0].origin_parent, origin.parent);
    assert_eq!(announced[0].origin_thread_id, origin.thread_id);
    assert_eq!(announced[0].triggered_by, origin.sender);
    assert_eq!(
        announced[0].prompted_message_id,
        MessageId::first(AuthorKind::User)
    );

    // The announcement retains the raw trigger while only the agent prompt is
    // enriched, including the required node for empty history.
    assert_eq!(announced[0].prompted_content, origin.content);
    assert_eq!(
        prompts(&container.agent()),
        [vec![ContentBlock::from(context_prompt(
            "@claude fix the failing test"
        ))]]
    );
}

#[tokio::test]
async fn claude_cloud_only_accepts_control_from_the_subscription_owner() {
    let (service, _repo, containers, _announcer, _runtimes) = harness();
    let mut command = open_command();
    command.runtime.kind = AgentKind::ClaudeCloud;
    command.runtime.harness = "claude-cloud".into();
    let owner = command.origin.sender.clone();
    let id = AgentSessionId::new();
    let open = service.execute(id, HarnessCommand::Open(command));
    let drive = async {
        while containers.spawned() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(id).unwrap();
        complete_handshake(&container).await;
    };
    let (opened, ()) = tokio::join!(open, drive);
    opened.unwrap();
    for actor in [None, Some(staff_sender())] {
        let error = service
            .control_event(
                id,
                ControlEvent {
                    action: AgentAction::prompt("spend another user's subscription"),
                    action_id: None,
                    actor,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(error, AgentSessionError::Forbidden));
    }
    // A non-turn control exercises the same owner gate without opening another turn.
    let owner_action = service.control_event(
        id,
        ControlEvent {
            action: AgentAction::prompt("owner follow-up"),
            action_id: None,
            actor: Some(owner),
        },
    );
    let drive = async {
        let container = containers.container(id).unwrap();
        container.agent().completes_prompt().await;
    };
    let (accepted, ()) = tokio::join!(owner_action, drive);
    accepted.unwrap();
}

/// The agent's MCP selection is snapshotted onto the session row at open, so
/// the proxy enforces exactly what this attach advertised for as long as the
/// session lives, whatever the agent is edited to later.
#[tokio::test]
async fn open_snapshots_the_agents_mcp_selection_onto_the_session() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let mut command = open_command();
    let selection = AgentMcpServers::Selected {
        servers: vec![agent_session::domain::model::AgentMcpServer {
            app_slug: "linear".to_owned(),
            server_name: "Linear".to_owned(),
        }],
    };
    command.runtime.mcp_servers = selection.clone();
    let id = AgentSessionId::new();

    let open = service.execute(id, HarnessCommand::Open(command));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(&containers))
            .expect("the spawned container is findable");
        complete_handshake(&container).await;
    };
    let (opened, ()) = tokio::join!(open, drive);
    opened.expect("open should succeed");

    let session = repo.get(id).await.expect("the session row exists");
    assert_eq!(session.mcp_servers, selection);
}

#[tokio::test]
async fn revoked_origin_access_blocks_open_before_anything_is_provisioned() {
    let composer = PromptComposerMock::default();
    let (service, repo, containers, announcer, _runtimes) = harness_with_edges(
        PromptContextMock::unauthorized("removed from the channel"),
        composer.clone(),
    );
    let id = AgentSessionId::new();

    let result = service
        .execute(id, HarnessCommand::Open(open_command()))
        .await;

    assert!(
        matches!(result, Err(HarnessError::PromptContext(_))),
        "a sender who may not write to the origin opens nothing: {result:?}"
    );
    assert!(repo.get(id).await.is_err());
    assert_eq!(containers.spawned(), 0);
    assert!(announcer.announced().is_empty());
    assert!(composer.calls().is_empty());
}

#[tokio::test]
async fn revoked_origin_access_blocks_the_connect_cursor_reply() {
    let (service, repo, containers, announcer, _runtimes) = harness_with_edges(
        PromptContextMock::unauthorized("removed from the channel"),
        PromptComposerMock::default(),
    );
    containers.block_with(SessionBlocker::CursorNotConnected);
    let mut command = open_command();
    command.bot_id = bot_id::CURSOR_BOT_ID;
    command.runtime.kind = AgentKind::Cursor;
    command.runtime.harness = "cursor".to_owned();
    let id = AgentSessionId::new();

    let result = service.execute(id, HarnessCommand::Open(command)).await;

    assert!(matches!(result, Err(HarnessError::PromptContext(_))));
    assert!(repo.get(id).await.is_err());
    assert_eq!(containers.spawned(), 0);
    assert!(service.inner.egress.provisioned().is_empty());
    assert!(announcer.announced().is_empty());
    assert!(announcer.declined().is_empty());
}

#[tokio::test]
async fn context_failure_still_calls_composer_with_empty_messages_and_delivers() {
    let composer = PromptComposerMock::default();
    let context = PromptContextMock::failing("messages unavailable");
    let (service, _repo, containers, announcer, _runtimes) =
        harness_with_edges(context.clone(), composer.clone());
    let id = AgentSessionId::new();

    let open = service.execute(id, HarnessCommand::Open(open_command()));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers.container(id).unwrap();
        complete_handshake(&container).await;
        container
    };
    let (result, container) = tokio::join!(open, drive);

    result.expect("context lookup is best-effort after Kafka admission");
    // Authorized twice: once before provisioning, once at dispatch, so a
    // revocation between the two still stops the prompt.
    assert_eq!(context.authorized().len(), 2);
    assert_eq!(announcer.announced().len(), 1);
    assert_eq!(
        composer.calls(),
        [(
            "@claude fix the failing test".to_owned(),
            Some(ConversationContext::default())
        )]
    );
    assert_eq!(
        prompts(&container.agent()),
        [vec![ContentBlock::from(context_prompt(
            "@claude fix the failing test"
        ))]]
    );
}

#[tokio::test]
async fn composer_failure_stops_open_delivery_and_keeps_the_prompt_queued() {
    let composer = PromptComposerMock::failing("lexical unavailable");
    let (service, repo, containers, announcer, _runtimes) =
        harness_with_edges(PromptContextMock::default(), composer.clone());
    let id = AgentSessionId::new();

    let result = service
        .execute(id, HarnessCommand::Open(open_command()))
        .await;

    // Composition happens at dispatch, after the session and its sandbox
    // exist - so those stand, while the chip is never posted and the prompt
    // never reaches the agent. The raw prompt stays queued: composition is
    // retried when the queue next drains, so a transient lexical outage does
    // not eat the mention.
    assert!(matches!(result, Err(HarnessError::PromptComposition(_))));
    assert_eq!(composer.calls().len(), 1);
    assert!(repo.get(id).await.is_ok());
    assert_eq!(containers.spawned(), 1);
    assert!(announcer.announced().is_empty());
    let queued = service
        .queued_controls(id)
        .await
        .expect("queue is listable");
    assert_eq!(queued.len(), 1);
    assert!(matches!(
        &queued[0].action,
        AgentAction::Prompt(action) if action.prompt == "@claude fix the failing test"
    ));
}

#[tokio::test]
async fn open_sends_context_but_not_agent_instructions_to_the_agent_prompt() {
    let context = vec![PriorMessage {
        sender: "previous@example.com".to_owned(),
        content: "previous channel message".to_owned(),
    }];
    let composer = PromptComposerMock::default();
    let (service, _repo, containers, announcer, _runtimes) = harness_with_edges(
        PromptContextMock::with_messages(context.clone()),
        composer.clone(),
    );
    let mut command = open_command();
    command.runtime.instructions = "Diagnose first.".to_owned();
    let raw = command.origin.content.clone();
    let id = AgentSessionId::new();

    let open = service.execute(id, HarnessCommand::Open(command));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers.container(id).unwrap();
        complete_handshake(&container).await;
        container
    };
    let (result, container) = tokio::join!(open, drive);
    result.unwrap();

    assert_eq!(announcer.announced()[0].prompted_content, raw);
    assert_eq!(
        composer.calls(),
        [(
            raw.clone(),
            Some(ConversationContext {
                anchor: None,
                messages: context,
            })
        )]
    );
    assert_eq!(
        prompts(&container.agent()),
        [vec![ContentBlock::from(context_prompt(&raw))]]
    );
}

/// A mention in a document comment: the agent is told which mark the comment
/// sits on and what that mark covered, so it can find the words the comment is
/// about instead of guessing from the comment body.
#[tokio::test]
async fn open_sends_the_comment_anchor_the_prompt_was_posted_on() {
    let context = ConversationContext {
        anchor: Some(CommentAnchor {
            mark_id: "0199f3d4-0000-7000-8000-00000000000a".to_owned(),
            marked_text: Some("the marked phrase".to_owned()),
            current: None,
        }),
        messages: vec![],
    };
    let composer = PromptComposerMock::default();
    let (service, _repo, containers, _announcer, _runtimes) = harness_with_edges(
        PromptContextMock::with_context(context.clone()),
        composer.clone(),
    );
    let command = open_command();
    let raw = command.origin.content.clone();
    let id = AgentSessionId::new();

    let open = service.execute(id, HarnessCommand::Open(command));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers.container(id).unwrap();
        complete_handshake(&container).await;
        container
    };
    let (result, _container) = tokio::join!(open, drive);
    result.unwrap();

    assert_eq!(composer.calls(), [(raw, Some(context))]);
}

/// A provider mention from someone missing account setup: the bot answers in
/// the thread with what to connect, and nothing is created for a session
/// that could never spawn - no row, no egress token, no chip.
#[tokio::test]
async fn a_mention_its_sender_is_not_set_up_for_is_declined_in_the_thread() {
    for (bot_id, kind, harness_slug, blocker) in [
        (
            bot_id::CURSOR_BOT_ID,
            AgentKind::Cursor,
            "cursor",
            SessionBlocker::CursorNotConnected,
        ),
        (
            bot_id::CODEX_BOT_ID,
            AgentKind::CodexCloud,
            "codex-cloud",
            SessionBlocker::CodexNotConnected,
        ),
        (
            bot_id::CODEX_BOT_ID,
            AgentKind::CodexCloud,
            "codex-cloud",
            SessionBlocker::CodexEnvironmentNotConfigured,
        ),
        (
            bot_id::CLAUDE_BOT_ID,
            AgentKind::ClaudeCloud,
            "claude-cloud",
            SessionBlocker::ClaudeNotConnected,
        ),
    ] {
        let (service, repo, containers, announcer, _runtimes) = harness();
        let id = AgentSessionId::new();
        containers.block_with(blocker);
        let mut command = open_command();
        command.bot_id = bot_id;
        command.runtime.kind = kind;
        command.runtime.harness = harness_slug.to_owned();
        let origin = command.origin.clone();

        let outcome = service
            .execute(id, HarnessCommand::Open(command))
            .await
            .expect("a declined mention is handled, not failed");

        assert_eq!(outcome, CommandOutcome::Completed);
        assert!(repo.get(id).await.is_err(), "no session row is created");
        assert_eq!(containers.spawned(), 0);
        assert!(service.inner.egress.provisioned().is_empty());
        assert!(announcer.announced().is_empty());
        assert_eq!(
            announcer.declined(),
            [DeclinedMention {
                bot_id,
                origin: AnnounceOrigin {
                    parent: origin.parent,
                    thread_id: origin.thread_id,
                    message_id: origin.message_id,
                },
                triggered_by: origin.sender,
                blocker,
            }]
        );
    }
}

/// The decline is the whole answer, so failing to post it is the open's
/// failure - the same way a session that cannot be announced is.
#[tokio::test]
async fn a_decline_that_cannot_be_posted_fails_the_open() {
    let (service, repo, containers, announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    containers.block_with(SessionBlocker::CursorNotConnected);
    announcer.fails("channel unavailable");

    let error = service
        .execute(id, HarnessCommand::Open(open_command()))
        .await
        .expect_err("the decline could not reach the thread");

    assert!(matches!(error, HarnessError::Announce(_)));
    assert!(repo.get(id).await.is_err(), "still no session row");
    assert_eq!(containers.spawned(), 0);
}

#[tokio::test]
async fn a_provisioning_failure_marks_the_session_disconnected() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    containers.fail_next_spawn("capacity exhausted");

    let error = service
        .execute(id, HarnessCommand::Open(open_command()))
        .await
        .expect_err("open should fail");

    assert!(matches!(error, HarnessError::Container(_)));
    let log = repo
        .list_by_session(id)
        .await
        .expect("session log can be read");
    assert!(matches!(
        &log[..],
        [agent_session::domain::model::StoredAgentSessionLog {
            entry: agent_session::domain::model::AgentSessionLog {
                content: Message::ToServer(ToServerMessage::Event {
                    event: SystemEvent::Disconnected,
                }),
                ..
            },
            ..
        }]
    ));
}

#[tokio::test]
async fn open_announces_while_the_container_is_still_booting() {
    let (service, _repo, containers, announcer, _runtimes) = harness();
    let id = AgentSessionId::new();

    let open = service.execute(id, HarnessCommand::Open(open_command()));
    let drive = async {
        loop {
            if !announcer.announced().is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(&containers))
            .expect("the spawned container is findable");
        assert_eq!(
            prompts(&container.agent()).len(),
            0,
            "the chip is announced before the prompt is delivered"
        );
        complete_handshake(&container).await;
    };
    let (opened, ()) = tokio::join!(open, drive);
    opened.expect("open should succeed");

    assert_eq!(announcer.announced().len(), 1);
}

#[tokio::test]
async fn forward_to_a_live_session_reuses_the_transport() {
    let composer = PromptComposerMock::default();
    let ((service, _repo, containers, announcer, _runtimes), mut turns) =
        harness_with_signals(PromptContextMock::default(), composer.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;

    service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("and add a regression test")),
        )
        .await
        .expect("forward to a live session should succeed");
    container.agent().wait_for_requests(4).await;

    assert_eq!(containers.spawned(), 1, "no second container");
    assert_eq!(containers.resumed(), 0, "no resume for a live session");
    assert_eq!(
        composer.calls().last(),
        Some(&(
            "and add a regression test".to_owned(),
            Some(ConversationContext::default())
        ))
    );
    assert_eq!(
        prompts(&container.agent())[1],
        vec![ContentBlock::from(context_prompt(
            "and add a regression test"
        ))]
    );
    let announced = announcer.announced();
    assert_eq!(announced.len(), 2);
    assert_eq!(
        announced[1].prompted_content, "and add a regression test",
        "the announcement must retain the raw triggering message"
    );
    assert_eq!(
        announced[1].prompted_message_id,
        MessageId {
            turn: agent_session::domain::model::TurnId(1),
            author: AuthorKind::User,
        }
    );
    assert_eq!(
        announced[1].origin_parent,
        MessageParent::Channel(Uuid::from_u128(0xf0))
    );
    assert_eq!(announced[1].origin_thread_id, Uuid::from_u128(0xf1));
}

#[tokio::test]
async fn composer_failure_stops_follow_up_announcement_and_delivery() {
    let composer = PromptComposerMock::default();
    let ((service, _repo, containers, announcer, _runtimes), mut turns) =
        harness_with_signals(PromptContextMock::default(), composer.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    // Idle first, so the follow-up dispatches - and fails - rather than
    // queueing behind the opening turn.
    turns.settled(id).await;
    *composer.failure.lock().unwrap() = Some("lexical unavailable".to_owned());
    let prompts_before = prompts(&container.agent()).len();
    let announcements_before = announcer.announced().len();

    let result = service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("do not deliver this")),
        )
        .await;

    assert!(matches!(result, Err(HarnessError::PromptComposition(_))));
    assert_eq!(
        composer.calls().last(),
        Some(&(
            "do not deliver this".to_owned(),
            Some(ConversationContext::default())
        ))
    );
    assert_eq!(prompts(&container.agent()).len(), prompts_before);
    assert_eq!(announcer.announced().len(), announcements_before);
}

#[tokio::test]
async fn forward_announces_before_delivering_the_prompt() {
    let ((service, _repo, containers, announcer, _runtimes), mut turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let open = service.execute(id, HarnessCommand::Open(open_command()));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(&containers))
            .expect("the spawned container is findable");
        complete_handshake(&container).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.expect("open should succeed");
    assert_eq!(prompts(&container.agent()).len(), 1);
    turns.settled(id).await;

    // A chip that cannot be posted has nothing to anchor the response, so the
    // prompt must not reach the agent at all.
    announcer.fails("the chip could not be posted");
    let result = service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("and add a regression test")),
        )
        .await;

    assert!(matches!(result, Err(HarnessError::Announce(_))));
    assert_eq!(
        prompts(&container.agent()).len(),
        1,
        "the chip is announced before the prompt is delivered"
    );
}

#[tokio::test]
async fn a_delivery_failure_is_not_automatically_resumed() {
    let ((service, _repo, containers, _announcer, _runtimes), mut turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let command = open_command();
    let id = AgentSessionId::new();
    let open = service.execute(id, HarnessCommand::Open(command));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(&containers))
            .expect("the spawned container is findable");
        complete_handshake(&container).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.expect("open should succeed");
    turns.settled(id).await;
    container.fails_sends_after(0);

    let result = service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("do not retry this")),
        )
        .await;

    assert!(matches!(result, Err(HarnessError::Session(_))));
    assert_eq!(containers.resumed(), 0);
}

#[tokio::test]
async fn forward_to_a_disconnected_session_resumes_acp_and_delivers_the_prompt() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;

    let forward = service.execute(
        id,
        HarnessCommand::Deliver(forward_message("continue after reconnecting")),
    );
    let drive_resume = async {
        loop {
            if containers.resumed() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let resumed = containers
            .container(id)
            .expect("the resumed container is findable");
        complete_resume(&resumed).await;
        resumed.agent().wait_for_requests(3).await;
        resumed
    };
    let (forwarded, resumed) = tokio::join!(forward, drive_resume);
    forwarded.expect("forward should resume and deliver the prompt");

    assert_eq!(containers.spawned(), 1, "resume must not spawn a sandbox");
    assert_eq!(containers.resumed(), 1);
    assert_eq!(
        prompts(&resumed.agent()),
        [vec![ContentBlock::from(context_prompt(
            "continue after reconnecting"
        ))]]
    );
    let prompt_logs = repo
        .list_by_session(id)
        .await
        .expect("session logs should be readable")
        .into_iter()
        .filter(|log| {
            matches!(
                &log.entry.content,
                Message::ToRuntime(agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage::Acp(
                    agent_runtime_protocol::domain::schema::v0::AcpMessage(
                        agent_client_protocol::RawJsonRpcMessage::Request(request)
                    )
                )) if request.method.as_ref() == "session/prompt"
            )
        })
        .count();
    assert_eq!(prompt_logs, 1);
}

#[tokio::test]
async fn concurrent_forwards_share_one_session_recovery() {
    let (service, repo, containers, announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;
    let first = service.execute(id, HarnessCommand::Deliver(forward_message("first")));
    let second = service.execute(id, HarnessCommand::Deliver(forward_message("second")));
    let drive_resume = async {
        loop {
            if containers.resumed() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let resumed = containers
            .container(id)
            .expect("the resumed container is findable");
        complete_resume(&resumed).await;
        resumed.agent().wait_for_requests(4).await;
        resumed.agent().completes_prompt().await;
        resumed
    };

    let (first, second, resumed) = tokio::join!(first, second, drive_resume);

    first.expect("the first message should be delivered");
    second.expect("the second message should be delivered");
    assert_eq!(containers.resumed(), 1);
    assert_eq!(
        prompts(&resumed.agent()),
        [
            vec![ContentBlock::from(context_prompt("first"))],
            vec![ContentBlock::from(context_prompt("second"))],
        ]
    );
    let announced_turns: Vec<_> = announcer
        .announced()
        .into_iter()
        .map(|announcement| announcement.prompted_message_id)
        .collect();
    assert_eq!(announced_turns[0], MessageId::first(AuthorKind::User));
    assert!(
        announced_turns[1].turn == agent_session::domain::model::TurnId(1)
            || announced_turns[1].turn == agent_session::domain::model::TurnId(2),
        "the second chip is the next prompt, or the one after a steer-stop: {announced_turns:?}"
    );
}

#[tokio::test]
async fn different_sessions_execute_concurrently() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let first_id = disconnected_session(&repo, &containers).await;
    let second_id = disconnected_session(&repo, &containers).await;
    let first = service.execute(first_id, HarnessCommand::Deliver(forward_message("first")));
    let second = service.execute(
        second_id,
        HarnessCommand::Deliver(forward_message("second")),
    );
    let drive_resumes = async {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if containers.resumed() == 2 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("different session workers should resume concurrently");

        let first_container = containers
            .container(first_id)
            .expect("the first resumed container is findable");
        let second_container = containers
            .container(second_id)
            .expect("the second resumed container is findable");
        tokio::join!(
            complete_resume(&first_container),
            complete_resume(&second_container)
        );
        let first_agent = first_container.agent();
        let second_agent = second_container.agent();
        tokio::join!(
            first_agent.wait_for_requests(3),
            second_agent.wait_for_requests(3)
        );
    };

    let (first, second, ()) = tokio::join!(first, second, drive_resumes);

    first.expect("the first session command should complete");
    second.expect("the second session command should complete");
}

#[tokio::test]
async fn an_admitted_command_survives_caller_cancellation() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;
    let completion = service.execute(
        id,
        HarnessCommand::Deliver(forward_message("finish even when nobody is waiting")),
    );
    drop(completion);

    loop {
        if containers.resumed() == 1 {
            break;
        }
        tokio::task::yield_now().await;
    }
    let resumed = containers
        .container(id)
        .expect("the resumed container is findable");
    complete_resume(&resumed).await;
    resumed.agent().wait_for_requests(3).await;

    assert_eq!(
        prompts(&resumed.agent()),
        [vec![ContentBlock::from(context_prompt(
            "finish even when nobody is waiting"
        ))]]
    );
}

#[tokio::test]
async fn a_failed_announce_surfaces_and_keeps_the_prompt_queued() {
    let (service, repo, containers, announcer, _runtimes) = harness();
    announcer.fails("comms is down");
    let id = AgentSessionId::new();

    let result = service
        .execute(id, HarnessCommand::Open(open_command()))
        .await;

    // Announcement happens at dispatch, after the sandbox exists - so the
    // spawn stands, while the prompt never reaches the agent (the chip
    // anchors the reply, so no chip means no delivery) and stays queued for
    // the next drain.
    assert!(matches!(result, Err(HarnessError::Announce(_))));
    assert_eq!(containers.spawned(), 1);
    assert_eq!(
        service
            .queued_controls(id)
            .await
            .expect("queue is listable")
            .len(),
        1
    );
    drop(repo);
}

/// The id of the single session the manager has spawned for.
fn session_of(containers: &MockContainerManager) -> AgentSessionId {
    containers
        .sessions()
        .into_iter()
        .next()
        .expect("exactly one session has a container")
}

/// Open a session and complete its handshake, returning its live container.
async fn live_session(
    service: &TestHarness,
    containers: &MockContainerManager,
    id: AgentSessionId,
) -> ContainerMock {
    let open = service.execute(id, HarnessCommand::Open(open_command()));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(containers))
            .expect("the spawned container is findable");
        complete_handshake(&container).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.expect("open should succeed");
    container
}

/// Open a Daytona-backed (sandboxed coder) session with a staff opener - the
/// only identity the gate in `execute` lets past `Open`.
async fn live_sandboxed_coder_session(
    service: &TestHarness,
    containers: &MockContainerManager,
    id: AgentSessionId,
) -> ContainerMock {
    let mut command = open_command();
    command.bot_id = bot_id::MACRO_CODER_BOT_ID;
    command.origin.sender = staff_sender();
    let open = service.execute(id, HarnessCommand::Open(command));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(containers))
            .expect("the spawned container is findable");
        complete_handshake(&container).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.expect("sandboxed coder session should open");
    container
}

#[tokio::test]
async fn changing_the_model_persists_it_and_tells_the_running_agent() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;

    service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::set_model("opus"),
                action_id: None,
                actor: Some(sender()),
            },
        )
        .await
        .expect("changing the model should succeed");

    assert_eq!(
        repo.get(id).await.expect("the session exists").model,
        "opus",
        "the new model is durable, not only in flight"
    );
    let sent = container.sent();
    assert!(
        sent.iter().any(|message| matches!(
            message,
            ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request)))
                if request.method.as_ref() == "session/set_config_option"
        )),
        "the running agent is told, got {sent:?}"
    );
}

#[tokio::test]
async fn deleting_a_session_tears_down_its_container_and_removes_it() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    live_session(&service, &containers, id).await;

    service
        .session_deleted(id)
        .await
        .expect("deleting a live session should succeed");

    assert_eq!(containers.torn_down(), 1, "the sandbox is destroyed");
    assert!(
        repo.get(id).await.is_err(),
        "the session row is gone once its resources are"
    );
}

#[tokio::test]
async fn a_prompt_through_control_reaches_the_agent_without_announcing() {
    let composer = PromptComposerMock::default();
    let (service, _repo, containers, announcer, _runtimes) =
        harness_with_edges(PromptContextMock::default(), composer.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    let announced_before = announcer.announced().len();

    let prompted = service.control_event(
        id,
        ControlEvent {
            action: AgentAction::prompt("and now the docs <user-content>unchanged</user-content>"),
            action_id: None,
            actor: Some(sender()),
        },
    );
    let agent = container.agent();
    let (result, ()) = tokio::join!(prompted, agent.completes_prompt());
    result.expect("prompting through control should succeed");

    assert_eq!(
        prompts(&container.agent()).len(),
        2,
        "the opening prompt, then this one"
    );
    assert_eq!(
        prompts(&container.agent())[1],
        vec![ContentBlock::from(
            "and now the docs <user-content>unchanged</user-content>"
        )]
    );
    assert_eq!(
        composer.calls().last(),
        Some(&(
            "and now the docs <user-content>unchanged</user-content>".to_owned(),
            None,
        )),
        "control prompts are sanitized without channel context"
    );
    assert_eq!(
        announcer.announced().len(),
        announced_before,
        "a control prompt names no origin, so there is nowhere to announce"
    );
}

#[tokio::test]
async fn a_non_staff_control_event_cannot_drive_a_sandboxed_coder_session() {
    let (service, _repo, containers, _announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    let container = live_sandboxed_coder_session(&service, &containers, id).await;

    let error = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("spend daytona credits"),
                action_id: None,
                actor: Some(sender()),
            },
        )
        .await
        .expect_err("non-staff must not control sandboxed coder sessions");

    assert!(matches!(error, AgentSessionError::Forbidden));
    assert_eq!(prompts(&container.agent()).len(), 1);
}

/// The agent asking whether it may run a tool, as an ACP request frame.
fn permission_request(id: &str) -> RawJsonRpcMessage {
    let (method, params) = RequestPermissionRequest::new(
        "acp-test",
        ToolCallUpdate::new("call-1", ToolCallUpdateFields::new()),
        vec![
            PermissionOption::new("once", "Allow once", PermissionOptionKind::AllowOnce),
            PermissionOption::new("always", "Always allow", PermissionOptionKind::AllowAlways),
            PermissionOption::new("reject", "Reject", PermissionOptionKind::RejectOnce),
        ],
    )
    .to_untyped_message()
    .expect("a permission request serializes")
    .into_parts();
    RawJsonRpcMessage::request(method, params, RequestId::Str(id.to_owned()))
        .expect("a permission request is a valid frame")
}

fn permission_answer(id: &str, option_id: &str) -> AgentAction {
    AgentAction::RespondToPermission(AgentPermissionAction {
        request_id: RequestId::Str(id.to_owned()),
        answer: PermissionAnswer::Selected {
            option_id: option_id.to_owned(),
        },
    })
}

/// The outcome the harness answered `id` with, from what the agent received.
fn permission_outcome(agent: &FakeAgent, id: &str) -> Option<RequestPermissionOutcome> {
    agent
        .received_responses()
        .into_iter()
        .find_map(|frame| match frame {
            RawJsonRpcMessage::Response(Response::Result { id: got, result })
                if got == RequestId::Str(id.to_owned()) =>
            {
                serde_json::from_value::<RequestPermissionResponse>(result)
                    .ok()
                    .map(|response| response.outcome)
            }
            _ => None,
        })
}

#[tokio::test]
async fn an_external_bots_permission_request_waits_for_a_users_answer() {
    // The test bot is nobody's fixed system bot, so its kind is `External`
    // and the policy source's default for it is to prompt.
    let (service, _repo, containers, _announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    let agent = container.agent();

    agent.sends_raw(permission_request("perm-1"));
    service
        .control_event(
            id,
            ControlEvent {
                action_id: None,
                action: permission_answer("perm-1", "once"),
                actor: Some(sender()),
            },
        )
        .await
        .expect("a user's answer reaches the agent");

    let responses = agent.received_responses();
    assert_eq!(
        responses.len(),
        1,
        "one answer, the user's; got {responses:?}"
    );
    assert_eq!(
        permission_outcome(&agent, "perm-1"),
        Some(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new("once")
        )),
        "the user's choice is what goes out, not auto-accept's broadest allow"
    );
}

#[tokio::test]
async fn a_harness_principal_cannot_answer_a_permission_request() {
    let (service, _repo, containers, _announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    container.agent().sends_raw(permission_request("perm-1"));

    let error = service
        .control_event(
            id,
            ControlEvent {
                action_id: None,
                action: permission_answer("perm-1", "always"),
                actor: None,
            },
        )
        .await
        .expect_err("a runtime must not approve its own tool call");

    assert!(matches!(error, AgentSessionError::Forbidden));
    assert!(container.agent().received_responses().is_empty());
}

#[tokio::test]
async fn a_managed_bots_permission_request_is_accepted_on_arrival() {
    let (service, _repo, containers, _announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    let container = live_sandboxed_coder_session(&service, &containers, id).await;
    let agent = container.agent();

    agent.sends_raw(permission_request("perm-1"));
    agent.wait_for_responses(1).await;

    assert_eq!(
        permission_outcome(&agent, "perm-1"),
        Some(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new("always")
        )),
        "a sandboxed runtime keeps today's auto-accept"
    );
}

#[tokio::test]
async fn answering_a_disconnected_session_does_not_wake_its_sandbox() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;

    let error = service
        .control_event(
            id,
            ControlEvent {
                action_id: None,
                action: permission_answer("perm-1", "once"),
                actor: Some(staff_sender()),
            },
        )
        .await
        .expect_err("nothing on a fresh connection could be waiting for this");

    assert!(matches!(error, AgentSessionError::Disconnected(_)));
    assert_eq!(
        containers.resumed(),
        0,
        "a prompt would resume the sandbox; an answer has nothing to deliver to"
    );
}

#[tokio::test]
async fn a_staff_control_event_can_drive_a_sandboxed_coder_session() {
    let ((service, _repo, containers, _announcer, _runtimes), mut turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = live_sandboxed_coder_session(&service, &containers, id).await;
    turns.settled(id).await;

    service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("continue"),
                action_id: None,
                actor: Some(staff_sender()),
            },
        )
        .await
        .expect("macro staff may control sandboxed coder sessions");

    assert_eq!(prompts(&container.agent()).len(), 2);
}

/// Open a session and finish the handshake, but leave the opening prompt's
/// turn running: the agent has received it and not answered.
async fn session_with_a_running_turn(
    service: &TestHarness,
    containers: &MockContainerManager,
    id: AgentSessionId,
) -> ContainerMock {
    let open = service.execute(id, HarnessCommand::Open(open_command()));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(containers))
            .expect("the spawned container is findable");
        complete_session_handshake(&container).await;
        // initialize, session/new, and the opening prompt.
        container.agent().wait_for_requests(3).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.expect("open should succeed");
    container
}

#[tokio::test]
async fn a_prompt_during_a_running_turn_queues_and_dispatches_when_it_ends() {
    let ((service, _repo, containers, _announcer, _runtimes), mut turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();

    let accepted = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("and then this"),
                action_id: None,
                actor: Some(sender()),
            },
        )
        .await
        .expect("a mid-turn prompt is accepted");

    assert_eq!(
        accepted.disposition,
        agent_session::domain::ports::ControlDisposition::Queued
    );
    let queued = service.queued_controls(id).await.expect("queue lists");
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].action_id, accepted.action_id);
    assert_eq!(prompts(&agent).len(), 1, "nothing reached the agent yet");

    // The running turn ends; the queued prompt dispatches with no user action.
    agent.completes_prompt().await;
    agent.wait_for_requests(4).await;
    turns.settled(id).await;

    assert_eq!(
        prompts(&agent)[1],
        // No announce origin, so no channel context: the raw text composes
        // to itself in the mock.
        vec![ContentBlock::from("and then this")]
    );
    assert!(
        service
            .queued_controls(id)
            .await
            .expect("queue lists")
            .is_empty()
    );
}

#[tokio::test]
async fn a_stop_cancels_the_turn_and_the_queue_keeps_draining() {
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();

    let queued = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("still wanted after the stop"),
                action_id: None,
                actor: Some(sender()),
            },
        )
        .await
        .expect("a mid-turn prompt is accepted");
    assert_eq!(
        queued.disposition,
        agent_session::domain::ports::ControlDisposition::Queued
    );

    // The stop bypasses the queue - it cancels the running turn, nothing else.
    let stopped = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::Stop,
                action_id: None,
                actor: Some(sender()),
            },
        )
        .await
        .expect("a stop is accepted");
    assert_eq!(
        stopped.disposition,
        agent_session::domain::ports::ControlDisposition::Sent
    );
    assert_eq!(
        service
            .queued_controls(id)
            .await
            .expect("queue lists")
            .len(),
        1,
        "a stop never clears the queue"
    );

    // The cancelled turn's answer is an ordinary turn end: the queued prompt
    // dispatches right away.
    agent.completes_prompt().await;
    agent.wait_for_requests(4).await;

    assert_eq!(
        prompts(&agent)[1],
        vec![ContentBlock::from("still wanted after the stop")]
    );
}

fn cancel_count(agent: &FakeAgent) -> usize {
    agent
        .received_notifications()
        .iter()
        .filter(|notification| matches!(notification, ClientNotification::CancelNotification(_)))
        .count()
}

#[tokio::test]
async fn a_channel_follow_up_stops_the_running_turn_announces_and_flushes() {
    let ((service, _repo, containers, announcer, _runtimes), mut turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();
    let announcements_before = announcer.announced().len();
    let prompts_before = prompts(&agent).len();

    // Work already waiting from the session page: the follow-up jumps it.
    let waiting = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("queued earlier from the session page"),
                action_id: None,
                actor: Some(staff_sender()),
            },
        )
        .await
        .expect("a mid-turn session-page prompt queues");
    assert_eq!(
        waiting.disposition,
        agent_session::domain::ports::ControlDisposition::Queued
    );

    let follow_up = forward_message("steer from the channel");
    let follow_up_id = follow_up.id;
    let outcome = service
        .execute(id, HarnessCommand::Deliver(follow_up))
        .await
        .expect("a channel follow-up is accepted");
    assert_eq!(outcome, CommandOutcome::Queued);
    assert_eq!(
        cancel_count(&agent),
        1,
        "the running turn is cancelled so the follow-up can flush: {:#?}",
        agent.received_notifications()
    );
    assert_eq!(
        prompts(&agent).len(),
        prompts_before,
        "the follow-up waits for the cancelled turn to end"
    );
    let queued = service.queued_controls(id).await.expect("queue lists");
    assert_eq!(
        queued
            .iter()
            .map(|entry| entry.action_id)
            .collect::<Vec<_>>(),
        [follow_up_id, waiting.action_id],
        "the follow-up is at the front, ahead of the earlier prompt"
    );

    let announced = announcer.announced();
    assert_eq!(
        announced.len(),
        announcements_before + 1,
        "the chip is posted on the follow-up before the cancelled turn ends"
    );
    let chip = announced.last().expect("the follow-up announced a chip");
    assert_eq!(chip.prompted_content, "steer from the channel");
    assert_eq!(chip.origin_message_id, Uuid::from_u128(0xf2));
    assert_eq!(
        chip.prompted_message_id,
        MessageId {
            // Stop is its own fold turn, so the follow-up opens the next one.
            turn: agent_session::domain::model::TurnId(2),
            author: AuthorKind::User,
        }
    );

    agent.completes_prompt().await;
    agent.wait_for_requests(4).await;

    assert_eq!(
        prompts(&agent)[1],
        vec![ContentBlock::from(context_prompt("steer from the channel"))],
        "the follow-up flushes first"
    );
    assert_eq!(
        announcer.announced().len(),
        announcements_before + 1,
        "dispatch does not post a second chip for the same follow-up"
    );

    agent.completes_prompt().await;
    agent.wait_for_requests(5).await;
    turns.settled(id).await;
    // No channel origin, so no composed context: the raw text goes out.
    assert_eq!(
        prompts(&agent)[2],
        vec![ContentBlock::from("queued earlier from the session page")],
        "the displaced prompt runs after the follow-up"
    );
}

#[tokio::test]
async fn an_idle_channel_follow_up_does_not_stop() {
    let ((service, _repo, containers, announcer, _runtimes), mut turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    let agent = container.agent();
    let cancels_before = cancel_count(&agent);

    service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("next, while idle")),
        )
        .await
        .expect("an idle follow-up dispatches");
    agent.wait_for_requests(4).await;

    assert_eq!(
        cancel_count(&agent),
        cancels_before,
        "nothing is running, so there is no turn to cancel"
    );
    assert_eq!(announcer.announced().len(), 2);
    assert_eq!(
        prompts(&agent)[1],
        vec![ContentBlock::from(context_prompt("next, while idle"))]
    );
}

#[tokio::test]
async fn queued_prompts_are_editable_and_removable_until_dispatch() {
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();

    let prompt = |text: &str| ControlEvent {
        action: AgentAction::prompt(text),
        action_id: None,
        actor: Some(sender()),
    };
    let second = service.control_event(id, prompt("second")).await.unwrap();
    let third = service.control_event(id, prompt("third")).await.unwrap();

    service
        .edit_queued_control(
            id,
            second.action_id,
            "second, rewritten".to_owned(),
            Some(staff_sender()),
        )
        .await
        .expect("a waiting prompt is editable");
    let queued = service.queued_controls(id).await.expect("queue lists");
    let rewritten = queued
        .iter()
        .find(|entry| entry.action_id == second.action_id)
        .expect("the edited entry is still queued");
    assert_eq!(
        rewritten.actor.as_ref(),
        Some(&staff_sender()),
        "an edit is attributed to the editor, not the original queuer"
    );
    service
        .remove_queued_control(id, third.action_id, Some(sender()))
        .await
        .expect("a waiting prompt is removable");

    agent.completes_prompt().await;
    agent.wait_for_requests(4).await;
    assert_eq!(
        prompts(&agent)[1],
        vec![ContentBlock::from("second, rewritten")],
        "the edit lands because dispatch is where the text is read"
    );

    // Dispatched means gone: there is no un-sending.
    let error = service
        .remove_queued_control(id, second.action_id, Some(sender()))
        .await
        .expect_err("a dispatched prompt is not removable");
    assert!(matches!(error, AgentSessionError::QueuedControlNotFound));
    let error = service
        .edit_queued_control(id, third.action_id, "resurrect".to_owned(), Some(sender()))
        .await
        .expect_err("a removed prompt is gone");
    assert!(matches!(error, AgentSessionError::QueuedControlNotFound));
}

#[tokio::test]
async fn a_model_change_bypasses_the_running_turn() {
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();

    let accepted = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::set_model("opus"),
                action_id: None,
                actor: Some(sender()),
            },
        )
        .await
        .expect("a model change is accepted mid-turn");

    assert_eq!(
        accepted.disposition,
        agent_session::domain::ports::ControlDisposition::Sent
    );
    assert!(
        service
            .queued_controls(id)
            .await
            .expect("queue lists")
            .is_empty(),
        "only turn-occupying actions queue"
    );
    agent.wait_for_requests(4).await;
}

#[tokio::test]
async fn a_control_event_is_accepted_under_the_callers_own_action_id() {
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let _container = session_with_a_running_turn(&service, &containers, id).await;

    let action_id = AgentActionId::mint();
    let accepted = service
        .control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("speculated by the caller"),
                action_id: Some(action_id),
                actor: Some(sender()),
            },
        )
        .await
        .expect("a prompt is accepted behind the running turn");

    assert_eq!(
        accepted.action_id, action_id,
        "the caller's id names the action it already speculated"
    );
    assert_eq!(
        accepted.disposition,
        agent_session::domain::ports::ControlDisposition::Queued
    );
    let queued = service.queued_controls(id).await.expect("queue lists");
    assert_eq!(
        queued
            .iter()
            .map(|entry| entry.action_id)
            .collect::<Vec<_>>(),
        vec![action_id],
        "the queue entry keeps the caller's id, so the log row will too"
    );
}

#[tokio::test]
async fn a_control_event_without_an_action_id_is_given_a_fresh_one() {
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let _container = session_with_a_running_turn(&service, &containers, id).await;

    let unnamed = |text: &str| ControlEvent {
        action: AgentAction::prompt(text),
        action_id: None,
        actor: Some(sender()),
    };
    let first = service.control_event(id, unnamed("first")).await.unwrap();
    let second = service.control_event(id, unnamed("second")).await.unwrap();

    assert_ne!(
        first.action_id, second.action_id,
        "each unnamed action is minted its own id"
    );
    assert_eq!(
        service
            .queued_controls(id)
            .await
            .expect("queue lists")
            .iter()
            .map(|entry| entry.action_id)
            .collect::<Vec<_>>(),
        vec![first.action_id, second.action_id]
    );
}

/// A retried POST arrives under the id the caller already used. It reports
/// what became of the first copy; it does not prompt the agent twice.
#[tokio::test]
async fn re_sending_a_waiting_action_id_does_not_queue_it_twice() {
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let _container = session_with_a_running_turn(&service, &containers, id).await;

    let action_id = AgentActionId::mint();
    let retried = || ControlEvent {
        action: AgentAction::prompt("said once"),
        action_id: Some(action_id),
        actor: Some(sender()),
    };
    let first = service.control_event(id, retried()).await.unwrap();
    let again = service.control_event(id, retried()).await.unwrap();

    assert_eq!(again.action_id, first.action_id);
    assert_eq!(again.disposition, first.disposition);
    assert_eq!(
        service
            .queued_controls(id)
            .await
            .expect("queue lists")
            .len(),
        1,
        "the retry is the same action, not a second one"
    );
}

#[tokio::test]
async fn compact_through_control_reaches_opencode_as_a_slash_command() {
    let (service, _repo, containers, _announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;

    let compacted = service.control_event(
        id,
        ControlEvent {
            action: AgentAction::Compact,
            action_id: None,
            actor: Some(sender()),
        },
    );
    let agent = container.agent();
    let (result, ()) = tokio::join!(compacted, agent.completes_prompt());
    result.expect("compaction should reach the running agent");

    assert_eq!(
        prompts(&container.agent()),
        [
            vec![ContentBlock::from(context_prompt(
                "@claude fix the failing test"
            ))],
            vec![ContentBlock::from(
                agent_runtime_protocol::domain::action::COMPACT_COMMAND
            )],
        ]
    );
}

#[tokio::test]
async fn a_prompt_through_control_resumes_a_disconnected_session() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;

    let prompted = service.control_event(
        id,
        ControlEvent {
            action: AgentAction::prompt("wake up"),
            action_id: None,
            actor: Some(staff_sender()),
        },
    );
    let drive_resume = async {
        loop {
            if containers.resumed() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let resumed = containers
            .container(id)
            .expect("the resumed container is findable");
        complete_resume(&resumed).await;
        resumed.agent().wait_for_requests(3).await;
        resumed
    };
    let (result, resumed) = tokio::join!(prompted, drive_resume);
    result.expect("a prompt must not be silently dropped when nothing is attached");

    assert_eq!(containers.resumed(), 1, "the container is brought back");
    assert_eq!(
        prompts(&resumed.agent()),
        [vec![ContentBlock::from("wake up")]]
    );
}

fn open_external_request(workspace: &str) -> OpenExternalAgentSession {
    OpenExternalAgentSession {
        profile: None,
        instructions: None,
        bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        workspace: workspace.to_owned(),
        repo_url: None,
        owner: model_owner::Owner::User(sender()),
        thread: None,
    }
}

/// Play the agent's half of the handshake for a session that binds lazily.
///
/// The ready event is repeated because it is the connection's, not the
/// session's: a session binds when it is prompted, and until it has, there is
/// nobody on the connection to act on being told the runtime is up.
async fn complete_bound_handshake(runtime: &ContainerMock) {
    let agent = runtime.agent();
    while agent.received_requests().is_empty() {
        runtime.sends_ready();
        tokio::task::yield_now().await;
    }
    agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
    agent.wait_for_requests(2).await;
    agent.opens_session(NewSessionResponse::new("acp-test"));
    agent.completes_prompt().await;
}

/// As [`complete_bound_handshake`], for a session the runtime is restoring.
async fn complete_bound_resume(runtime: &ContainerMock) {
    let agent = runtime.agent();
    while agent.received_requests().is_empty() {
        runtime.sends_ready();
        tokio::task::yield_now().await;
    }
    agent.completes_initialize(
        InitializeResponse::new(PROTOCOL_VERSION).agent_capabilities(
            AgentCapabilities::new().session_capabilities(
                SessionCapabilities::new().resume(SessionResumeCapabilities::new()),
            ),
        ),
    );
    agent.wait_for_requests(2).await;
    assert!(matches!(
        &agent.received_requests()[1],
        ClientRequest::ResumeSessionRequest(request) if request.session_id.to_string() == "acp-test"
    ));
    agent.resumes_session(ResumeSessionResponse::new());
    agent.completes_prompt().await;
}

/// Wait until a session has noticed that its transport ended.
///
/// Until it has, the session still counts as attached, and an action sent in
/// that window goes into the dead socket instead of being retried onto a live
/// one - so anything about reconnecting has to start from here.
async fn await_disconnect(repo: &InMemoryAgentSessionRepo, id: AgentSessionId) {
    loop {
        let log = repo
            .list_by_session(id)
            .await
            .expect("the session log is readable");
        let disconnected = log.iter().any(|stored| {
            matches!(
                &stored.entry.content,
                Message::ToServer(ToServerMessage::Event {
                    event: SystemEvent::Disconnected
                })
            )
        });
        if disconnected {
            return;
        }
        tokio::task::yield_now().await;
    }
}

/// Prompt a session the way the control endpoint does.
async fn prompt(
    service: &TestHarness,
    id: AgentSessionId,
    content: &str,
) -> Result<CommandOutcome, HarnessError> {
    service
        .execute(
            id,
            HarnessCommand::Deliver(DeliverAction::prompt(
                AgentAction::prompt(content),
                Some(sender()),
                None,
            )),
        )
        .await
}

#[tokio::test]
async fn an_external_open_provisions_nothing_and_prompts_nobody() {
    let (service, repo, containers, announcer, runtimes) = harness();

    let session = service
        .open_external_session(open_external_request("/home/operator/code"))
        .await
        .expect("an external open needs no runtime yet");

    // The row exists with the stated workspace, but nothing was provisioned,
    // nothing was announced, and no prompt has gone anywhere: the runtime
    // delivers the first prompt itself through the control endpoint after
    // dialing in.
    assert_eq!(session.workspace, "/home/operator/code");
    assert_eq!(containers.spawned(), 0);
    assert!(announcer.announced().is_empty());

    // The operator's runtime dials in for the bot. Nothing happens to the
    // session: no handshake, no ACP session, nothing sent - a session nobody
    // is prompting costs the runtime nothing.
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(session.bot_id), runtime.clone());
    assert!(runtime.agent().received_requests().is_empty());
    assert!(
        repo.get(session.id)
            .await
            .expect("the session row exists")
            .acp_session_id
            .is_none()
    );

    // The runtime forwards the mention through control: that is what binds the
    // session to the connection, handshakes, and lands the prompt.
    let prompted = service.control_event(
        session.id,
        ControlEvent {
            action: AgentAction::prompt("@claude fix the failing test"),
            action_id: None,
            actor: Some(sender()),
        },
    );
    let (result, ()) = tokio::join!(prompted, complete_bound_handshake(&runtime));
    result.expect("the first prompt binds the session and reaches the runtime");
    let requests = runtime.agent().received_requests();
    let ClientRequest::NewSessionRequest(open) = &requests[1] else {
        panic!("expected session/new")
    };
    assert_eq!(open.mcp_servers.len(), 1);
    let agent_client_protocol::schema::v1::McpServer::Http(server) = &open.mcp_servers[0] else {
        panic!("expected HTTP MCP")
    };
    assert_eq!(server.name, "macro_internal");
    assert!(server.url.ends_with("/mcp/internal"));
    assert!(
        server
            .headers
            .iter()
            .any(|header| header.name == "Authorization")
    );

    assert_eq!(
        prompts(&runtime.agent()),
        [vec![ContentBlock::from("@claude fix the failing test")]]
    );
    // Prompt delivery is ordered behind the `session/new` response, so the
    // negotiated ACP session id has been persisted by now.
    let row = repo.get(session.id).await.expect("the session row exists");
    assert_eq!(row.acp_session_id, Some(SessionId::new("acp-test")));
}

#[tokio::test]
async fn a_macrod_session_selects_its_saved_model_before_the_first_prompt() {
    for accepted in [true, false] {
        let (service, repo, _, _, runtimes) = harness();
        let mut request = open_external_request("/home/operator/code");
        request.profile = Some(agent_session::domain::ports::ManagedAgentProfile {
            model: "gpt-5.6-luna".into(),
            harness: harness_id::MACROD_HARNESS_SLUG.into(),
            instructions: String::new(),
            mcp_servers: AgentMcpServers::OwnerConnections,
        });
        let session = service.open_external_session(request).await.unwrap();
        assert_eq!(session.model, "gpt-5.6-luna");
        assert_eq!(session.harness, harness_id::MACROD_HARNESS_SLUG);
        let runtime = ContainerMock::default();
        runtimes.attach(harness_for_bot(session.bot_id), runtime.clone());

        let drive = async {
            let agent = runtime.agent();
            while agent.received_requests().is_empty() {
                runtime.sends_ready();
                tokio::task::yield_now().await;
            }
            agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
            agent.wait_for_requests(2).await;
            let config = |model| {
                serde_json::json!([{
                    "id": "model", "name": "Model", "type": "select",
                    "currentValue": model, "options": []
                }])
            };
            agent.opens_session(
                serde_json::from_value(serde_json::json!({
                    "sessionId": "acp-test", "configOptions": config("gpt-6-astra")
                }))
                .unwrap(),
            );
            agent.wait_for_requests(3).await;
            assert!(prompts(&agent).is_empty());
            let row = repo.get(session.id).await.unwrap();
            assert_eq!(
                row.model, "gpt-5.6-luna",
                "session/new must not overwrite the saved selection"
            );
            assert!(row.acp_session_id.is_none());
            let frames = agent.received_frames();
            let RawJsonRpcMessage::Request(change) = frames.last().unwrap() else {
                panic!("expected model selection");
            };
            assert_eq!(change.method.as_ref(), "session/set_config_option");
            assert_eq!(
                serde_json::to_value(&change.params).unwrap()["value"],
                "gpt-5.6-luna"
            );
            if accepted {
                agent.sends_raw(RawJsonRpcMessage::response(
                    change.id.clone(),
                    Ok(serde_json::json!({
                        "configOptions": config("gpt-5.6-luna")
                    })),
                ));
                agent.completes_prompt().await;
            } else {
                agent.sends_error(
                    change.id.clone(),
                    agent_client_protocol::Error::invalid_params(),
                );
            }
        };
        let (result, ()) = tokio::join!(prompt(&service, session.id, "hello"), drive);
        if accepted {
            result.unwrap();
            assert_eq!(prompts(&runtime.agent()).len(), 1);
        } else {
            assert!(result.is_err());
            assert!(prompts(&runtime.agent()).is_empty());
        }
        let row = repo.get(session.id).await.unwrap();
        assert_eq!(
            row.model, "gpt-5.6-luna",
            "a retry must retain the requested model"
        );
        assert_eq!(row.acp_session_id.is_some(), accepted);
    }
}

#[tokio::test]
async fn a_bound_session_stays_on_its_connection_until_it_drops() {
    let (service, _repo, _containers, _announcer, runtimes) = harness();
    let session = service
        .open_external_session(open_external_request("/srv/agent"))
        .await
        .expect("open");

    let first = ContainerMock::default();
    runtimes.attach(harness_for_bot(session.bot_id), first.clone());
    let (result, ()) = tokio::join!(
        prompt(&service, session.id, "fix the failing test"),
        complete_bound_handshake(&first)
    );
    result.expect("the first prompt binds the session");

    // Already bound: a second prompt goes straight down the same connection,
    // with no second handshake to drive.
    let prompted = prompt(&service, session.id, "and now the docs");
    let agent = first.agent();
    let (result, ()) = tokio::join!(prompted, agent.completes_prompt());
    result.expect("a bound session needs no rebinding");
    assert_eq!(
        prompts(&first.agent()),
        ["fix the failing test", "and now the docs"]
            .map(|text| vec![ContentBlock::from(text)])
            .to_vec()
    );
}

#[tokio::test]
async fn a_prompt_after_a_redial_restores_the_session_on_the_new_connection() {
    let (service, repo, containers, _announcer, runtimes) = harness();
    let session = service
        .open_external_session(open_external_request("/srv/agent"))
        .await
        .expect("open");

    let first = ContainerMock::default();
    runtimes.attach(harness_for_bot(session.bot_id), first.clone());
    let (result, ()) = tokio::join!(
        prompt(&service, session.id, "fix the failing test"),
        complete_bound_handshake(&first)
    );
    result.expect("the first prompt binds the session");

    // The socket dies and the operator's runtime redials. The session is not
    // touched by the redial itself - the next prompt is what restores it, on
    // the ACP session id the row remembers.
    first.disconnects();
    await_disconnect(&repo, session.id).await;
    let second = ContainerMock::default();
    runtimes.attach(harness_for_bot(session.bot_id), second.clone());
    assert!(second.agent().received_requests().is_empty());

    let (result, ()) = tokio::join!(
        prompt(&service, session.id, "carry on"),
        complete_bound_resume(&second)
    );
    result.expect("a prompt after a reconnect restores the session on the way through");
    assert_eq!(
        prompts(&second.agent()),
        [vec![ContentBlock::from("carry on")]]
    );
    // Still an operator-hosted session: reconnecting never provisions.
    assert_eq!(containers.spawned(), 0);
    assert_eq!(containers.resumed(), 0);
}

/// The create menu names no bot, so its sessions open as the deployment's
/// managed default - the in-process bot when one is configured - with that
/// bot's own defaults stamped on.
#[tokio::test]
async fn a_managed_session_opens_as_the_managed_default_bot() {
    let repo = InMemoryAgentSessionRepo::new();
    let containers = MockContainerManager::new();
    let inmem_bot = BotId::TEST_B;
    let service = AgentHarnessService::new(
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            Arc::new(NoOpTurnObserver),
            Arc::new(NoopLifecyclePublisher),
            ReplicaId::mint(),
        ),
        containers.clone(),
        AnnouncerMock::new(),
        TestConnections::new(MirrorBindings, RuntimeRegistry::<ContainerSender>::new()),
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        NoPeers,
        KindDefaultPolicies,
        HarnessDefaults::new(SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: SessionRepository::parse("https://github.com/macro-inc/macro"),
        })
        .with_bot(
            inmem_bot,
            SessionDefaults {
                bot_id: inmem_bot,
                model: "fast-model".to_owned(),
                harness: "macro-inmem".to_owned(),
                repo_url: SessionRepository::parse("https://github.com/macro-inc/macro"),
            },
        )
        .with_managed_bot(inmem_bot),
        NoopLifecyclePublisher,
        crate::domain::pending::PendingCommands::new(),
        crate::domain::ports::NoPromptMentions,
        crate::domain::ports::NoopAgentSessionNotifier,
    );

    let session = service
        .open_managed_session(agent_session::domain::ports::OpenManagedSession {
            id: None,
            repo_url: None,
            repo_branch: None,
            instructions: None,
            model: None,
            owner: model_owner::Owner::User(sender()),
            prompt: None,
            profile: None,
        })
        .await
        .expect("the managed session should open");

    assert_eq!(session.bot_id, inmem_bot);
    assert_eq!(session.model, "fast-model");
    assert_eq!(session.harness, "macro-inmem");
}

#[tokio::test]
async fn a_managed_session_resumes_its_sandbox_rather_than_a_dialed_in_runtime() {
    let (service, repo, containers, _announcer, runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;
    let session = repo.get(id).await.expect("the session row exists");

    // A runtime dialed in claiming to serve the managed bot. Its sandbox is
    // this deployment's to run, so the dial must not be what the session is
    // restored onto.
    let dialed_in = ContainerMock::default();
    runtimes.attach(harness_for_bot(session.bot_id), dialed_in.clone());

    let prompted = service.control_event(
        id,
        ControlEvent {
            action: AgentAction::prompt("wake up"),
            action_id: None,
            actor: Some(staff_sender()),
        },
    );
    let drive_resume = async {
        loop {
            if containers.resumed() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let resumed = containers
            .container(id)
            .expect("the resumed container is findable");
        complete_resume(&resumed).await;
        resumed.agent().wait_for_requests(3).await;
        resumed
    };
    let (result, resumed) = tokio::join!(prompted, drive_resume);
    result.expect("a managed session resumes its own sandbox");

    assert_eq!(
        prompts(&resumed.agent()),
        [vec![ContentBlock::from("wake up")]]
    );
    assert!(
        dialed_in.agent().received_requests().is_empty(),
        "the dialed-in runtime is never consulted for a managed session"
    );
}

#[tokio::test]
async fn a_disconnected_external_session_never_gets_a_sandbox() {
    let (service, _repo, containers, _announcer, _runtimes) = harness();
    let session = service
        .open_external_session(open_external_request("/srv/agent"))
        .await
        .expect("open");

    // No runtime ever dialed in, so a follow-up prompt has nowhere to go -
    // and must NOT fall into the managed resume path and boot a sandbox for
    // an operator-hosted bot.
    let error = service
        .execute(session.id, HarnessCommand::Deliver(forward_message("more")))
        .await
        .expect_err("nothing is attached");

    assert!(
        matches!(
            error,
            HarnessError::Disconnected(id) if id == session.id,
        ),
        "got {error:?}"
    );
    assert_eq!(containers.spawned(), 0);
    assert_eq!(containers.resumed(), 0);
}

#[tokio::test]
async fn an_external_open_with_a_mention_announces_as_the_sessions_bot() {
    let (service, _repo, containers, announcer, _runtimes) = harness();
    let mut request = open_external_request("/srv/agent");
    let bot = request.bot_id;
    request.thread = Some(agent_session::domain::ports::SessionThread {
        parent: MessageParent::Channel(macro_uuid::Uuid::from_u128(0xC1)),
        thread_id: macro_uuid::Uuid::from_u128(0xC2),
        message_id: macro_uuid::Uuid::from_u128(0xC2),
        content: "@opencode fix the flaky test".to_owned(),
    });

    service
        .open_external_session(request)
        .await
        .expect("open with a mention");

    // The magic-chip announcement lands in the mention's thread, posted as
    // the session's own bot - still with nothing provisioned.
    assert_eq!(containers.spawned(), 0);
    let announced = announcer.announced();
    assert_eq!(announced.len(), 1);
    assert_eq!(announced[0].bot_id, bot);
    assert_eq!(
        announced[0].origin_parent,
        MessageParent::Channel(macro_uuid::Uuid::from_u128(0xC1))
    );
    assert_eq!(
        announced[0].prompted_content,
        "@opencode fix the flaky test"
    );
}

#[tokio::test]
async fn an_external_prompt_announce_posts_into_the_observed_origin() {
    let (service, _repo, containers, announcer, _runtimes) = harness();
    let request = open_external_request("/srv/agent");
    let bot = request.bot_id;
    let session = service
        .open_external_session(request)
        .await
        .expect("open without a mention");

    // No runtime ever attached: the chip must still post, anchoring
    // whatever reply arrives once the runtime comes back.
    service
        .announce_external_prompt(
            session.id,
            crate::domain::model::AnnouncePrompt {
                bot_id: bot,
                origin: AnnounceOrigin {
                    parent: MessageParent::Channel(macro_uuid::Uuid::from_u128(0xAA)),
                    thread_id: macro_uuid::Uuid::from_u128(0xAB),
                    message_id: macro_uuid::Uuid::from_u128(0xAC),
                },
                content: "follow-up from the channel".to_owned(),
                sender: sender(),
            },
        )
        .await
        .expect("the observed prompt announces");

    assert_eq!(containers.spawned(), 0);
    let announced = announcer.announced();
    assert_eq!(announced.len(), 1, "threadless open posts no chip");
    assert_eq!(announced[0].bot_id, bot);
    assert_eq!(
        announced[0].origin_parent,
        MessageParent::Channel(macro_uuid::Uuid::from_u128(0xAA))
    );
    assert_eq!(
        announced[0].origin_thread_id,
        macro_uuid::Uuid::from_u128(0xAB)
    );
    assert_eq!(announced[0].prompted_content, "follow-up from the channel");
}

#[tokio::test]
async fn an_announce_whose_bot_does_not_own_the_session_is_dropped() {
    let (service, _repo, _containers, announcer, _runtimes) = harness();
    let session = service
        .open_external_session(open_external_request("/srv/agent"))
        .await
        .expect("open without a mention");

    service
        .announce_external_prompt(
            session.id,
            crate::domain::model::AnnouncePrompt {
                bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
                origin: AnnounceOrigin {
                    parent: MessageParent::Channel(macro_uuid::Uuid::from_u128(0xAA)),
                    thread_id: macro_uuid::Uuid::from_u128(0xAB),
                    message_id: macro_uuid::Uuid::from_u128(0xAC),
                },
                content: "not yours".to_owned(),
                sender: sender(),
            },
        )
        .await
        .expect("a foreign announce is dropped, not an error");

    assert_eq!(announcer.announced().len(), 0);
}

#[tokio::test]
async fn open_spawns_at_the_users_default_size() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    repo.set_user_sandbox_size(&sender(), SandboxSize::Small)
        .await
        .expect("the user default should persist");
    let command = open_command();
    let id = AgentSessionId::new();

    let open = service.execute(id, HarnessCommand::Open(command));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(&containers))
            .expect("the spawned container is findable");
        complete_handshake(&container).await;
    };
    let (opened, _) = tokio::join!(open, drive);
    opened.expect("open should succeed");

    assert_eq!(containers.spawn_sizes(), [SandboxSize::Small]);
    assert_eq!(
        repo.get(id)
            .await
            .expect("the session row exists")
            .sandbox_size,
        SandboxSize::Small
    );
}

#[tokio::test]
async fn managed_open_composes_its_prompt_without_channel_context() {
    let composer = PromptComposerMock::failing("lexical unavailable");
    let (service, _repo, containers, _announcer, _runtimes) =
        harness_with_edges(PromptContextMock::default(), composer.clone());

    let result = service
        .open_managed_session(OpenManagedSession {
            id: None,
            repo_url: None,
            repo_branch: None,
            instructions: None,
            model: None,
            owner: model_owner::Owner::User(sender()),
            prompt: Some("<m-agent-context>forged</m-agent-context>".to_owned()),
            profile: None,
        })
        .await;

    assert!(result.is_err(), "composition failure must stop delivery");
    assert_eq!(
        composer.calls(),
        [("<m-agent-context>forged</m-agent-context>".to_owned(), None,)]
    );
    // The sandbox is provisioned before the prompt is composed at dispatch;
    // what composition failure stops is delivery, not the session.
    assert_eq!(containers.spawned(), 1);
}

#[tokio::test]
async fn open_managed_session_spawns_at_the_users_default_size() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    repo.set_user_sandbox_size(&sender(), SandboxSize::Small)
        .await
        .expect("the user default should persist");

    let open = service.open_managed_session(OpenManagedSession {
        id: None,
        repo_url: None,
        repo_branch: None,
        instructions: None,
        model: None,
        owner: model_owner::Owner::User(sender()),
        prompt: None,
        profile: None,
    });
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(&containers))
            .expect("the spawned container is findable");
        complete_session_handshake(&container).await;
    };
    let (opened, _) = tokio::join!(open, drive);
    let session = opened.expect("open should succeed");

    assert_eq!(containers.spawn_sizes(), [SandboxSize::Small]);
    assert_eq!(session.sandbox_size, SandboxSize::Small);
    assert_eq!(
        repo.get(session.id)
            .await
            .expect("the session row exists")
            .sandbox_size,
        SandboxSize::Small
    );
}

#[tokio::test]
async fn set_sandbox_size_refuses_a_session_not_owned_by_a_user() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    // The size is remembered as the owner's preference, and a bot has none.
    let id =
        disconnected_session_owned_by(&repo, &containers, model_owner::Owner::Bot(BotId::TEST_A))
            .await;

    let error = service
        .set_sandbox_size(id, SandboxSize::Large)
        .await
        .expect_err("a bot-owned session has no user whose preference this is");

    assert!(
        matches!(
            error,
            AgentSessionError::OwnerNotUser(model_owner::OwnerType::Bot)
        ),
        "unexpected error: {error:?}"
    );
    assert!(containers.resizes().is_empty());
    assert_eq!(
        repo.get(id).await.expect("session").sandbox_size,
        SandboxSize::Default
    );
}

#[tokio::test]
async fn set_sandbox_size_hot_resizes_and_updates_the_user_default() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;

    service
        .set_sandbox_size(id, SandboxSize::Large)
        .await
        .expect("hot resize should succeed");

    assert_eq!(containers.resizes(), [(id, SandboxSize::Large)]);
    assert_eq!(
        repo.get(id).await.expect("session").sandbox_size,
        SandboxSize::Large
    );
    assert_eq!(
        repo.user_sandbox_size(&sender())
            .await
            .expect("user default"),
        SandboxSize::Large
    );
    assert_eq!(containers.resumed(), 0);
}

#[tokio::test]
async fn set_sandbox_size_restart_closes_resizes_and_resumes() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;

    service
        .set_sandbox_size(id, SandboxSize::Small)
        .await
        .expect("restart resize should succeed");

    assert_eq!(containers.resizes(), [(id, SandboxSize::Small)]);
    assert_eq!(containers.resumed(), 1);
    assert_eq!(
        repo.get(id).await.expect("session").sandbox_size,
        SandboxSize::Small
    );
}

#[tokio::test]
async fn set_sandbox_size_same_tier_does_not_resize() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;

    service
        .set_sandbox_size(id, SandboxSize::Default)
        .await
        .expect("no-op size should succeed");

    assert!(containers.resizes().is_empty());
    assert_eq!(containers.resumed(), 0);
    assert_eq!(
        repo.get(id).await.expect("session").sandbox_size,
        SandboxSize::Default
    );
}

#[tokio::test]
async fn set_sandbox_size_unsupported_does_not_persist() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;
    containers.refuse_resize();

    let error = service
        .set_sandbox_size(id, SandboxSize::Large)
        .await
        .expect_err("unsupported resize should fail");
    assert!(
        error.to_string().contains("cannot resize"),
        "unexpected error: {error}"
    );
    assert_eq!(
        repo.get(id).await.expect("session").sandbox_size,
        SandboxSize::Default
    );
    assert_eq!(containers.resumed(), 0);
}

type ForwardCall = (crate::domain::ports::CommandTarget, AgentSessionId);

/// A [`CommandForwarder`] that records its calls and reports success.
#[derive(Clone, Default)]
struct RecordingForwarder {
    calls: Arc<Mutex<Vec<ForwardCall>>>,
}

impl crate::domain::ports::CommandForwarder for RecordingForwarder {
    async fn forward(
        &self,
        session: AgentSessionId,
        _command: HarnessCommand,
        target: crate::domain::ports::CommandTarget,
    ) -> crate::domain::error::Result<CommandOutcome> {
        self.calls.lock().unwrap().push((target, session));
        Ok(CommandOutcome::Completed)
    }
}

/// Claim a session for a fabricated peer replica.
async fn claim_as_peer(
    repo: &InMemoryAgentSessionRepo,
    session: AgentSessionId,
) -> agent_session::domain::model::SessionClaim {
    use agent_session::domain::model::{ClaimOutcome, ReplicaId};
    use agent_session::domain::ports::SessionOwnership as _;
    let peer = ReplicaId::mint();
    repo.heartbeat(peer, None).await.expect("peer heartbeats");
    match repo.claim(session, peer).await.expect("peer claims") {
        ClaimOutcome::Claimed(claim) => claim,
        ClaimOutcome::ManagedElsewhere(_) => panic!("nobody else should hold the test session"),
    }
}

/// A command for a session a live peer manages goes through the command bus
/// and never executes here: the session outlives a Delete this replica would
/// otherwise have applied.
#[tokio::test]
async fn commands_for_a_peer_managed_session_forward_through_redis() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = agent_session::testing::test_agent_session(AgentSessionId::new());
    let id = session.id;
    repo.insert_session(session);
    let claim = claim_as_peer(&repo, id).await;
    let forwarder = RecordingForwarder::default();
    let service = AgentHarnessService::new(
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            Arc::new(NoOpTurnObserver),
            Arc::new(NoopLifecyclePublisher),
            ReplicaId::mint(),
        ),
        MockContainerManager::new(),
        AnnouncerMock::new(),
        TestConnections::new(MirrorBindings, RuntimeRegistry::<ContainerSender>::new()),
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        forwarder.clone(),
        KindDefaultPolicies,
        SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: SessionRepository::parse("https://github.com/macro-inc/macro"),
        },
        NoopLifecyclePublisher,
        crate::domain::pending::PendingCommands::new(),
        crate::domain::ports::NoPromptMentions,
        crate::domain::ports::NoopAgentSessionNotifier,
    );

    service
        .execute(id, HarnessCommand::Delete)
        .await
        .expect("the forwarded command succeeds");

    assert_eq!(forwarder.calls.lock().unwrap().len(), 1);
    assert!(matches!(
        forwarder.calls.lock().unwrap()[0],
        (crate::domain::ports::CommandTarget::Replica(replica), session)
            if replica == claim.replica && session == id
    ));
    assert!(
        repo.get(id).await.is_ok(),
        "the delete ran on the peer, not here"
    );
}

#[tokio::test]
async fn unmanaged_external_session_forwards_to_its_remote_harness() {
    let repo = InMemoryAgentSessionRepo::new();
    let runtimes = TestConnections::new(MirrorBindings, RuntimeRegistry::new());
    let forwarder = RecordingForwarder::default();
    let service = AgentHarnessService::new(
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            Arc::new(NoOpTurnObserver),
            Arc::new(NoopLifecyclePublisher),
            ReplicaId::mint(),
        ),
        MockContainerManager::new(),
        AnnouncerMock::new(),
        runtimes,
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        forwarder.clone(),
        KindDefaultPolicies,
        SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: SessionRepository::parse("https://github.com/macro-inc/macro"),
        },
        NoopLifecyclePublisher,
        crate::domain::pending::PendingCommands::new(),
        crate::domain::ports::NoPromptMentions,
        crate::domain::ports::NoopAgentSessionNotifier,
    );
    let session = service
        .open_external_session(open_external_request("/srv/agent"))
        .await
        .expect("external session opens without a local runtime");

    service
        .execute(session.id, HarnessCommand::Delete)
        .await
        .expect("the remote harness executes the command");

    assert_eq!(
        *forwarder.calls.lock().unwrap(),
        [(
            crate::domain::ports::CommandTarget::Harness(harness_for_bot(session.bot_id)),
            session.id,
        )]
    );
    assert!(
        repo.get(session.id).await.is_ok(),
        "the command did not execute on this replica"
    );
}

/// The lifecycle facts the harness publishes, end to end through a live
/// session: the mock agent answers, asks, and dies; the recorder says what
/// downstream would have heard.
mod lifecycle_events {
    use super::*;

    use agent_client_protocol::schema::v1::{
        CreateElicitationRequest, ElicitationFormMode, ElicitationSchema, ElicitationSessionScope,
        RequestId,
    };
    use agent_fold::domain::model::TurnId;
    use agent_runtime_protocol::domain::action::{ElicitationAnswer, ElicitationRequestId};
    use agent_session::domain::events::AgentSessionLifecycleEvent as Lifecycle;

    /// Open a session from a mention and let its first turn settle: `Opened`,
    /// `TurnStarted`, `TurnEnded`, `Settled`.
    async fn settled_session() -> (TestBench, TurnSignals, AgentSessionId, ContainerMock) {
        let (bench, mut turns) =
            harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
        let id = AgentSessionId::new();
        let container = live_session(&bench.0, &bench.2, id).await;
        turns.settled(id).await;
        turns.lifecycle_published(4).await;
        (bench, turns, id, container)
    }

    fn ask(agent: &FakeAgent, request_id: i64, question: &str) {
        let request = CreateElicitationRequest::new(
            ElicitationFormMode::new(
                ElicitationSessionScope::new(SessionId::new("acp-test")),
                ElicitationSchema::new(),
            ),
            question,
        );
        let (method, params) = request
            .to_untyped_message()
            .expect("an elicitation serializes")
            .into_parts();
        agent.sends_raw(
            RawJsonRpcMessage::request(method, params, RequestId::Number(request_id))
                .expect("elicitation params are an object"),
        );
    }

    #[tokio::test]
    async fn the_first_turn_publishes_opened_started_ended_and_settled() {
        let ((_, _, _, announcer, _), turns, id, _container) = settled_session().await;

        let chip = announcer.announced_messages()[0].message_id;
        let events = turns.lifecycle();
        assert!(
            matches!(
                events.as_slice(),
                [
                    Lifecycle::Opened(opened),
                    Lifecycle::TurnStarted(started),
                    Lifecycle::TurnEnded(ended),
                    Lifecycle::Settled(settled),
                ] if opened.identity.session_id == id
                    // No origin asserted: the in-memory repo cannot derive the
                    // thread's channel, which only the message row knows.
                    && started.turn == TurnId(0)
                    && started.announcement_message_id == Some(chip)
                    && ended.turn == TurnId(0)
                    && ended.stop_reason == "end_turn"
                    && ended.queued_remaining == 0
                    && ended.announcement_message_id == Some(chip)
                    && settled.last_turn.as_ref().is_some_and(|turn| {
                        turn.turn == TurnId(0)
                            && turn.stop_reason == "end_turn"
                            && turn.announcement_message_id == Some(chip)
                    })
            ),
            "one full turn, in order: {events:#?}"
        );
    }

    #[tokio::test]
    async fn settled_carries_everyone_who_drove_the_session() {
        let ((_, _, _, _, _), turns, id, _container) = settled_session().await;

        let events = turns.lifecycle();
        let Some(Lifecycle::Settled(settled)) = events.last() else {
            panic!("the first turn settles: {events:#?}");
        };
        assert_eq!(settled.identity.session_id, id);
        // The mention's sender prompted the session and owns it: once each.
        assert_eq!(settled.identity.audience, vec![sender()]);
    }

    #[tokio::test]
    async fn settled_notifies_the_audience_through_the_notifier() {
        let ((_, _, _, _, _), turns, id, _container) = settled_session().await;

        let notified = turns.notifier.notified();
        assert!(
            matches!(
                notified.as_slice(),
                [crate::domain::notifications::PlannedNotification::Settled(notify)]
                    if notify.recipients == vec![sender()]
                        && notify.metadata.session.session_id == id.as_uuid()
            ),
            "one settled notification for the owner: {notified:#?}"
        );
    }

    #[tokio::test]
    async fn a_prompt_naming_others_publishes_mentioned_without_its_author() {
        let mentions = PromptMentionsMock::new();
        let reviewer = MacroUserIdStr::try_from_email("reviewer@macro.com").unwrap();
        let ((service, _, containers, _, _), turns) = harness_with_mentions(
            PromptContextMock::default(),
            PromptComposerMock::default(),
            mentions.clone(),
        );
        let id = AgentSessionId::new();
        let _container = live_session(&service, &containers, id).await;
        turns.lifecycle_published(4).await;
        // The author names themself and a reviewer; only the reviewer is news.
        mentions.mentions(vec![staff_sender(), reviewer.clone()]);

        service
            .execute(
                id,
                HarnessCommand::Deliver(forward_message("@reviewer look")),
            )
            .await
            .expect("the prompt is accepted");
        turns.lifecycle_published(6).await;

        let events = turns.lifecycle();
        assert!(
            matches!(
                &events[4..6],
                [Lifecycle::Mentioned(mentioned), Lifecycle::TurnStarted(_)]
                    if mentioned.identity.session_id == id
                        && mentioned.mentioned_by == Some(staff_sender())
                        && mentioned.mentioned == vec![reviewer.clone()]
            ),
            "mentioned is published on accept, before the turn starts: {events:#?}"
        );
        assert_eq!(
            mentions.prompts().last(),
            Some(&"@reviewer look".to_owned())
        );
    }

    #[tokio::test]
    async fn a_prompt_naming_only_its_author_publishes_nothing() {
        let mentions = PromptMentionsMock::new();
        mentions.mentions(vec![staff_sender()]);
        let ((service, _, containers, _, _), turns) = harness_with_mentions(
            PromptContextMock::default(),
            PromptComposerMock::default(),
            mentions,
        );
        let id = AgentSessionId::new();
        let _container = live_session(&service, &containers, id).await;
        turns.lifecycle_published(4).await;

        service
            .execute(id, HarnessCommand::Deliver(forward_message("note to self")))
            .await
            .expect("the prompt is accepted");
        turns.lifecycle_published(5).await;

        assert!(
            matches!(
                turns.lifecycle().as_slice(),
                [.., Lifecycle::TurnStarted(_)]
            ),
            "no mentioned event: {:#?}",
            turns.lifecycle()
        );
    }

    #[tokio::test]
    async fn a_mention_lookup_failure_never_holds_up_the_prompt() {
        let mentions = PromptMentionsMock::new();
        mentions.fails("lexical service unreachable");
        let ((service, _, containers, _, _), turns) = harness_with_mentions(
            PromptContextMock::default(),
            PromptComposerMock::default(),
            mentions,
        );
        let id = AgentSessionId::new();
        let container = live_session(&service, &containers, id).await;
        turns.lifecycle_published(4).await;

        service
            .execute(id, HarnessCommand::Deliver(forward_message("@someone")))
            .await
            .expect("the prompt is accepted despite the failure");
        turns.lifecycle_published(5).await;

        assert!(
            matches!(
                turns.lifecycle().as_slice(),
                [.., Lifecycle::TurnStarted(_)]
            ),
            "the turn starts and nothing about mentions is published: {:#?}",
            turns.lifecycle()
        );
        assert_eq!(
            prompts(&container.agent()).len(),
            2,
            "the prompt reached the agent"
        );
    }

    #[tokio::test]
    async fn a_queued_prompt_defers_settled_until_it_too_is_answered() {
        let ((service, _, _, _, _), turns, id, container) = settled_session().await;
        let agent = container.agent();

        // Session-page prompts queue without steering; a channel follow-up
        // would stop the running turn instead. See
        // `a_channel_follow_up_stops_the_running_turn_announces_and_flushes`.
        let prompt = |text: &str| ControlEvent {
            action: AgentAction::prompt(text),
            action_id: None,
            actor: Some(staff_sender()),
        };
        service
            .control_event(id, prompt("first"))
            .await
            .expect("first prompt dispatches");
        let queued = service
            .control_event(id, prompt("second"))
            .await
            .expect("second prompt is accepted");
        assert_eq!(
            queued.disposition,
            agent_session::domain::ports::ControlDisposition::Queued
        );
        turns.lifecycle_published(5).await;

        agent.completes_prompt().await;
        turns.lifecycle_published(7).await;
        let events = turns.lifecycle();
        assert!(
            matches!(
                &events[4..7],
                [
                    Lifecycle::TurnStarted(first),
                    Lifecycle::TurnEnded(first_ended),
                    Lifecycle::TurnStarted(second),
                ] if first.turn == TurnId(1)
                    && first_ended.turn == TurnId(1)
                    && first_ended.queued_remaining == 1
                    && second.turn == TurnId(2)
            ),
            "the first turn ends with one queued and the second starts, no settle between: {events:#?}"
        );

        agent.completes_prompt().await;
        turns.lifecycle_published(9).await;
        let events = turns.lifecycle();
        assert!(
            matches!(
                &events[7..9],
                [Lifecycle::TurnEnded(ended), Lifecycle::Settled(settled)]
                    if ended.turn == TurnId(2)
                        && ended.queued_remaining == 0
                        && settled.last_turn.as_ref().is_some_and(|turn| turn.turn == TurnId(2))
            ),
            "the second turn ends and the session settles: {events:#?}"
        );
    }

    #[tokio::test]
    async fn a_question_publishes_waiting_for_input_then_input_received() {
        let ((service, _, _, announcer, _), turns, id, container) = settled_session().await;
        let agent = container.agent();
        service
            .execute(id, HarnessCommand::Deliver(forward_message("pick one")))
            .await
            .expect("the prompt dispatches");
        turns.lifecycle_published(5).await;
        let chip = announcer
            .announced_messages()
            .last()
            .expect("the forward posted a chip")
            .message_id;

        ask(&agent, 7, "Which approach?");
        turns.lifecycle_published(6).await;
        assert!(
            matches!(
                turns.lifecycle().last(),
                Some(Lifecycle::WaitingForInput(waiting))
                    if waiting.turn == TurnId(1)
                        && waiting.question == "Which approach?"
                        && waiting.announcement_message_id == Some(chip)
            ),
            "the question is published against its chip: {:#?}",
            turns.lifecycle()
        );

        service
            .execute(
                id,
                HarnessCommand::Deliver(DeliverAction::control(ControlEvent {
                    action: AgentAction::respond_elicitation(
                        ElicitationRequestId::Number(7),
                        ElicitationAnswer::Decline,
                    ),
                    action_id: None,
                    actor: Some(staff_sender()),
                })),
            )
            .await
            .expect("the answer is delivered");
        turns.lifecycle_published(7).await;
        assert!(
            matches!(
                turns.lifecycle().last(),
                Some(Lifecycle::InputReceived(received)) if received.turn == TurnId(1)
            ),
            "answering clears the wait: {:#?}",
            turns.lifecycle()
        );
    }

    /// The excerpt is the fold's last text for the turn - no refold, no
    /// second read of the log - which is what the chip shows once done.
    #[tokio::test]
    async fn settled_carries_the_agents_last_text() {
        let ((service, _, _, _, _), turns, id, container) = settled_session().await;
        let agent = container.agent();
        service
            .execute(
                id,
                HarnessCommand::Deliver(forward_message("say something")),
            )
            .await
            .expect("the prompt dispatches");
        turns.lifecycle_published(5).await;

        agent.sends_raw(
            RawJsonRpcMessage::notification(
                "session/update".to_owned(),
                serde_json::json!({
                    "sessionId": "acp-test",
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": "Hello there."}
                    }
                }),
            )
            .expect("notification params are an object"),
        );
        agent.completes_prompt().await;
        turns.lifecycle_published(7).await;

        let events = turns.lifecycle();
        assert!(
            matches!(
                &events[5..7],
                [Lifecycle::TurnEnded(ended), Lifecycle::Settled(settled)]
                    if ended.stop_reason == "end_turn"
                        && settled.last_turn.as_ref().is_some_and(|turn| {
                            turn.excerpt.as_deref() == Some("Hello there.")
                                && turn.stop_reason == "end_turn"
                        })
            ),
            "settled quotes the agent's last words: {events:#?}"
        );
    }

    #[tokio::test]
    async fn a_death_mid_turn_publishes_stopped_with_the_turn_and_no_settled() {
        let ((service, _, _, _, _), turns, id, container) = settled_session().await;
        service
            .execute(id, HarnessCommand::Deliver(forward_message("keep going")))
            .await
            .expect("the prompt dispatches");
        turns.lifecycle_published(5).await;

        container.disconnects();
        turns.lifecycle_published(6).await;

        let events = turns.lifecycle();
        assert!(
            matches!(
                events.last(),
                Some(Lifecycle::Stopped(stopped))
                    if stopped.turn_in_flight.as_ref().is_some_and(|turn| turn.turn == TurnId(1))
                        && !stopped.reason.is_empty()
            ),
            "the stop names the turn it interrupted: {events:#?}"
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, Lifecycle::Settled(_)))
                .count(),
            1,
            "only the first turn settled; a death is not a settle: {events:#?}"
        );
    }

    #[tokio::test]
    async fn a_delete_publishes_deleted_and_nothing_after() {
        let ((service, _, _, _, _), turns, id, _container) = settled_session().await;

        service
            .execute(id, HarnessCommand::Delete)
            .await
            .expect("delete succeeds");
        turns.lifecycle_published(5).await;

        // Deleting also stops the actor, but by the time that stop is
        // observed the row is gone and nothing can describe the session, so
        // `Deleted` is the last word. Give a late `Stopped` every chance to
        // show up wrongly before asserting it did not.
        tokio::task::yield_now().await;
        let events = turns.lifecycle();
        assert!(
            matches!(
                events.last(),
                Some(Lifecycle::Deleted(deleted)) if deleted.identity.session_id == id
            ),
            "deleted is the last fact about the session: {events:#?}"
        );
        assert_eq!(events.len(), 5, "nothing follows deleted: {events:#?}");
    }
}

#[tokio::test]
async fn codex_named_session_provisions_egress_without_advertising_mcp() {
    let (service, repo, containers, _, _) = harness();
    let open = service.open_managed_session(OpenManagedSession {
        id: None,
        repo_url: None,
        repo_branch: None,
        owner: model_owner::Owner::User(sender()),
        instructions: None,
        model: None,
        prompt: Some("inspect".into()),
        profile: Some(agent_session::domain::ports::SelectedManagedPersona {
            bot_id: bot_id::CODEX_BOT_ID,
            profile: None,
        }),
    });
    let drive = async {
        while containers.spawned() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(session_of(&containers)).unwrap();
        complete_handshake(&container).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    let session = opened.unwrap();
    assert_eq!(service.inner.egress.provisioned().len(), 1);
    assert_eq!(
        repo.find_by_egress_token_hash("test-token-hash")
            .await
            .unwrap()
            .unwrap()
            .id,
        session.id
    );
    assert_eq!(session.harness, "codex-cloud");
    assert!(session.repo_url.is_none());
    assert_eq!(
        repo.get(session.id).await.unwrap().mcp_servers,
        AgentMcpServers::Selected {
            servers: Vec::new()
        }
    );
    let requests = container.agent().received_requests();
    let ClientRequest::NewSessionRequest(request) = &requests[1] else {
        panic!("expected session/new")
    };
    assert!(request.mcp_servers.is_empty());
}

#[tokio::test]
async fn codex_channel_mention_provisions_egress_without_advertising_mcp() {
    let (service, repo, containers, announcer, _) = harness();
    let mut command = open_command();
    command.bot_id = bot_id::CODEX_BOT_ID;
    command.runtime = AgentRuntimeConfig {
        kind: AgentKind::CodexCloud,
        model: String::new(),
        harness: "codex-cloud".into(),
        instructions: String::new(),
        mcp_servers: AgentMcpServers::Selected {
            servers: Vec::new(),
        },
    };
    command.origin.content = "@codex inspect the repository".into();
    let id = AgentSessionId::new();
    let open = service.execute(id, HarnessCommand::Open(command));
    let drive = async {
        while containers.spawned() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(session_of(&containers)).unwrap();
        complete_handshake(&container).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.unwrap();
    let stored = repo.get(id).await.unwrap();
    assert_eq!(stored.bot_id, bot_id::CODEX_BOT_ID);
    assert_eq!(service.inner.egress.provisioned().len(), 1);
    assert_eq!(
        repo.find_by_egress_token_hash("test-token-hash")
            .await
            .unwrap()
            .unwrap()
            .id,
        id
    );
    assert_eq!(stored.harness, "codex-cloud");
    assert!(stored.repo_url.is_none());
    assert_eq!(announcer.announced()[0].bot_id, bot_id::CODEX_BOT_ID);
    let requests = container.agent().received_requests();
    let ClientRequest::NewSessionRequest(request) = &requests[1] else {
        panic!("expected session/new")
    };
    assert!(request.mcp_servers.is_empty());
}

mod reopen;

/// The owner's reachable repositories, as the GitHub App would list them.
struct SelectedRepositories(Vec<crate::domain::model::ReachableRepository>);

impl SelectedRepositories {
    /// Repositories whose clones start on `main`.
    fn urls(urls: &[&str]) -> Self {
        Self(
            urls.iter()
                .map(|url| crate::domain::model::ReachableRepository {
                    url: (*url).to_owned(),
                    default_branch: Some("main".to_owned()),
                })
                .collect(),
        )
    }
}

#[async_trait::async_trait]
impl crate::domain::ports::ReachableRepositories for SelectedRepositories {
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> crate::domain::error::Result<Vec<crate::domain::model::ReachableRepository>> {
        Ok(self.0.clone())
    }
}

/// A model chosen on the way in is the session's model, from the row onwards.
///
/// The regression this pins: the picked model used to arrive as a set-model
/// action sent before the first prompt. That is a control, controls take a
/// turn of their own, and the automatic naming that only fires on a session's
/// first turn therefore never ran - every session opened on a chosen model
/// stayed "Agent Session" for life.
#[tokio::test]
async fn a_chosen_model_is_the_session_model_from_creation() {
    let (service, repo, containers, _, _) = harness();
    let open = service.open_managed_session(OpenManagedSession {
        id: None,
        repo_url: None,
        repo_branch: None,
        owner: model_owner::Owner::User(sender()),
        instructions: None,
        model: Some("claude-4.5-sonnet-thinking".to_owned()),
        prompt: None,
        profile: Some(agent_session::domain::ports::SelectedManagedPersona {
            bot_id: bot_id::CURSOR_BOT_ID,
            profile: None,
        }),
    });
    let drive = async {
        let session = containers.first_spawned().await;
        let container = containers.container(session).unwrap();
        complete_session_handshake(&container).await;
    };
    let (opened, _) = tokio::join!(open, drive);
    let session = repo.get(opened.unwrap().id).await.unwrap();
    assert_eq!(session.model, "claude-4.5-sonnet-thinking");
}

/// The agents-view create path names the Cursor bot with no persisted
/// profile. The deployment default harness is the sandboxed coder's
/// `opencode`; Cursor sessions must not inherit it.
#[tokio::test]
async fn a_cursor_managed_session_is_always_stamped_cursor() {
    let (service, repo, containers, _, _) = harness();
    let open = service.open_managed_session(OpenManagedSession {
        id: None,
        repo_url: None,
        repo_branch: None,
        owner: model_owner::Owner::User(sender()),
        instructions: None,
        model: None,
        prompt: None,
        profile: Some(agent_session::domain::ports::SelectedManagedPersona {
            bot_id: bot_id::CURSOR_BOT_ID,
            profile: None,
        }),
    });
    let drive = async {
        while containers.spawned() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(session_of(&containers)).unwrap();
        complete_session_handshake(&container).await;
    };
    let (opened, _) = tokio::join!(open, drive);
    let session = repo.get(opened.unwrap().id).await.unwrap();
    assert_eq!(session.bot_id, bot_id::CURSOR_BOT_ID);
    assert_eq!(session.harness, "cursor");
}

fn explicit_cursor_request() -> OpenManagedSession {
    OpenManagedSession {
        id: None,
        owner: model_owner::Owner::User(sender()),
        instructions: None,
        model: None,
        prompt: None,
        repo_url: Some("https://github.com/macro-inc/macro".into()),
        repo_branch: Some(
            agent_session::domain::repository_branch::RepositoryBranch::parse(
                "feature/home".into(),
            )
            .unwrap(),
        ),
        profile: Some(agent_session::domain::ports::SelectedManagedPersona {
            bot_id: bot_id::CURSOR_BOT_ID,
            profile: None,
        }),
    }
}

#[tokio::test]
async fn selected_repository_requires_owner_access_before_provisioning() {
    let (service, _, containers, _, _) = harness();
    let service = service.with_repositories(Arc::new(SelectedRepositories::urls(&[])));
    let result = service
        .open_managed_session(explicit_cursor_request())
        .await;
    assert!(matches!(
        result,
        Err(agent_session::domain::error::AgentSessionError::Forbidden)
    ));
    assert!(service.inner.egress.provisioned().is_empty());
    assert_eq!(containers.spawned(), 0);
}

#[tokio::test]
async fn selected_repository_and_branch_are_persisted_for_cursor() {
    let (service, repo, containers, _, _) = harness();
    let service = service.with_repositories(Arc::new(SelectedRepositories::urls(&[
        "https://github.com/macro-inc/macro",
    ])));
    let open = service.open_managed_session(explicit_cursor_request());
    let drive = async {
        while containers.spawned() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(session_of(&containers)).unwrap();
        complete_session_handshake(&container).await;
    };
    let (opened, _) = tokio::join!(open, drive);
    let session = repo.get(opened.unwrap().id).await.unwrap();
    assert_eq!(session.harness, "cursor");
    assert_eq!(
        session.repo_url.as_deref(),
        Some("https://github.com/macro-inc/macro")
    );
    assert_eq!(
        session.repo_branch.as_ref().map(|branch| branch.as_str()),
        Some("feature/home")
    );
}

/// Opens `request` against a listing that reaches `macro-inc/macro` with the
/// given default branch, and reads back the branch the row was given.
async fn branch_persisted_for(
    default_branch: Option<&str>,
    request: OpenManagedSession,
) -> Option<String> {
    let (service, repo, containers, _, _) = harness();
    let service = service.with_repositories(Arc::new(SelectedRepositories(vec![
        crate::domain::model::ReachableRepository {
            url: "https://github.com/macro-inc/macro".to_owned(),
            default_branch: default_branch.map(str::to_owned),
        },
    ])));
    let open = service.open_managed_session(request);
    let drive = async {
        while containers.spawned() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(session_of(&containers)).unwrap();
        complete_session_handshake(&container).await;
    };
    let (opened, _) = tokio::join!(open, drive);
    let session = repo.get(opened.unwrap().id).await.unwrap();
    session
        .repo_branch
        .as_ref()
        .map(|branch| branch.as_str().to_owned())
}

#[tokio::test]
async fn selected_repository_without_branch_starts_on_its_default_branch() {
    let mut request = explicit_cursor_request();
    request.repo_branch = None;
    assert_eq!(
        branch_persisted_for(Some("develop"), request)
            .await
            .as_deref(),
        Some("develop")
    );
}

#[tokio::test]
async fn selected_repository_without_a_default_branch_starts_on_main() {
    let mut request = explicit_cursor_request();
    request.repo_branch = None;
    assert_eq!(
        branch_persisted_for(None, request).await.as_deref(),
        Some("main")
    );
}

#[tokio::test]
async fn explicit_branch_wins_over_the_repository_default() {
    assert_eq!(
        branch_persisted_for(Some("develop"), explicit_cursor_request())
            .await
            .as_deref(),
        Some("feature/home")
    );
}

#[test]
fn starting_branch_falls_back_to_main_for_an_unusable_default() {
    assert_eq!(
        super::open::starting_branch(Some("release")).as_str(),
        "release"
    );
    assert_eq!(
        super::open::starting_branch(Some("bad..name")).as_str(),
        "main"
    );
    assert_eq!(super::open::starting_branch(None).as_str(), "main");
}

#[tokio::test]
async fn branch_without_repository_is_rejected_before_provisioning() {
    let (service, _, containers, _, _) = harness();
    let mut request = explicit_cursor_request();
    request.repo_url = None;
    assert!(matches!(
        service.open_managed_session(request).await,
        Err(agent_session::domain::error::AgentSessionError::InvalidRepositorySelection(_))
    ));
    assert!(service.inner.egress.provisioned().is_empty());
    assert_eq!(containers.spawned(), 0);
}

struct PromptPolicies;
impl crate::domain::ports::PermissionPolicySource for PromptPolicies {
    async fn permission_policy(
        &self,
        _: BotId,
    ) -> anyhow::Result<crate::domain::model::PermissionPolicyConfig> {
        Ok(crate::domain::model::PermissionPolicyConfig::Fixed(
            AgentKind::External,
        ))
    }
}

#[tokio::test]
async fn a_non_staff_session_editor_can_approve_a_managed_session_request() {
    let ((service, _repo, containers, _announcer, _runtimes), _signals) = harness_with_policy(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        PromptPolicies,
    );
    let id = AgentSessionId::new();
    let container = live_sandboxed_coder_session(&service, &containers, id).await;
    let agent = container.agent();
    agent.sends_raw(permission_request("editor-approval"));
    service
        .control_event(
            id,
            ControlEvent {
                action_id: None,
                action: permission_answer("editor-approval", "once"),
                actor: Some(sender()),
            },
        )
        .await
        .expect("a human editor can approve even though only staff may prompt the coder");
    assert_eq!(
        permission_outcome(&agent, "editor-approval"),
        Some(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new("once")
        ))
    );
}
