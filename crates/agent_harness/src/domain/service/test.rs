//! Integration tests: the real orchestrator over the real session service,
//! with in-memory persistence, mock containers, a fake agent, and a
//! recording announcer. Only the edges are doubles.

use std::sync::{Arc, Mutex};

use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::{
    AgentCapabilities, ClientRequest, ContentBlock, InitializeResponse, NewSessionResponse,
    ResumeSessionResponse, SessionCapabilities, SessionId, SessionResumeCapabilities,
};
use agent_fold::domain::model::{AuthorKind, MessageId};
use agent_fold::domain::service::FoldedMessageService;
use agent_runtime_protocol::domain::{
    action::AgentAction,
    schema::v0::{AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage},
};
use agent_session::PROTOCOL_VERSION;
use agent_session::domain::model::{
    AgentSessionId, CreateAgentSessionParams, Message, SandboxSize,
};
use agent_session::domain::ports::{
    AgentSessionLogRepo as _, AgentSessionNotificationRecipient as _, AgentSessionRepo as _,
    ControlEvent, NoOpRealtime,
};
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::testing::InMemoryAgentSessionRepo;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use tokio::sync::mpsc;

use super::AgentHarnessService;
use super::into_session_error;
use crate::domain::error::HarnessError;
use crate::domain::model::{
    AgentKind, AgentRuntimeConfig, AnnounceOrigin, CommandOutcome, DeliverAction, HarnessCommand,
    HarnessDefaults, MentionOrigin, OpenSession, PriorChannelMessage, SessionDefaults,
    SpawnContainer,
};
use crate::domain::ports::{
    AgentPromptComposer, ChannelPromptContext, ContainerManager as _, NoPeers,
};
use crate::outbound::runtime_registry::RuntimeRegistry;
use crate::testing::helpers::agent::FakeAgent;
use crate::testing::helpers::announcer::AnnouncerMock;
use crate::testing::helpers::containers::{ContainerMock, ContainerSender, MockContainerManager};
use crate::testing::helpers::egress::{EgressProvisionerMock, test_egress};
use agent_session::domain::error::AgentSessionError;
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
        },
        origin: MentionOrigin {
            channel_id: macro_uuid::generate_uuid_v7(),
            thread_id,
            message_id: thread_id,
            sender: sender(),
            content: "@claude fix the failing test".to_owned(),
        },
    }
}

/// A prompt arriving from a channel that is not the session's own, so it is
/// the announcing case.
fn forward_message(content: &str) -> DeliverAction {
    // Staff: `disconnected_session` is a Daytona coder bot, and the
    // execute() gate admits only macro.com actors onto those.
    DeliverAction::prompt(
        content,
        Some(staff_sender()),
        Some(AnnounceOrigin {
            channel_id: macro_uuid::Uuid::from_u128(0xf0),
            thread_id: macro_uuid::Uuid::from_u128(0xf1),
            message_id: macro_uuid::Uuid::from_u128(0xf2),
        }),
    )
}

#[derive(Clone, Default)]
struct PromptContextMock {
    messages: Arc<Mutex<Vec<PriorChannelMessage>>>,
    failure: Arc<Mutex<Option<String>>>,
}

impl PromptContextMock {
    fn with_messages(messages: Vec<PriorChannelMessage>) -> Self {
        Self {
            messages: Arc::new(Mutex::new(messages)),
            failure: Arc::default(),
        }
    }

    fn failing(message: &str) -> Self {
        Self {
            messages: Arc::default(),
            failure: Arc::new(Mutex::new(Some(message.to_owned()))),
        }
    }
}

impl ChannelPromptContext for PromptContextMock {
    async fn authorize_member(
        &self,
        _actor: &MacroUserIdStr<'static>,
        _channel_id: Uuid,
    ) -> crate::domain::error::Result<()> {
        Ok(())
    }

    async fn preceding_messages(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> crate::domain::error::Result<Vec<PriorChannelMessage>> {
        if let Some(message) = self.failure.lock().unwrap().clone() {
            return Err(HarnessError::PromptContext(rootcause::report!("{message}")));
        }
        Ok(self.messages.lock().unwrap().clone())
    }
}

type PromptCompositionCall = (String, Option<Vec<PriorChannelMessage>>);

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
        messages: Option<&[PriorChannelMessage]>,
    ) -> crate::domain::error::Result<String> {
        self.calls.lock().unwrap().push((
            prompt_markdown.to_owned(),
            messages.map(|messages| messages.to_vec()),
        ));
        if let Some(message) = self.failure.lock().unwrap().clone() {
            return Err(HarnessError::PromptComposition(rootcause::report!(
                "{message}"
            )));
        }
        Ok(if messages.is_some() {
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
    fn turn_ended(&self, id: AgentSessionId) {
        agent_session::domain::ports::SessionTurnObserver::turn_ended(&self.harness, id);
        let _ = self.ended.send(id);
    }

    fn session_stopped(&self, id: AgentSessionId) {
        agent_session::domain::ports::SessionTurnObserver::session_stopped(&self.harness, id);
    }
}

/// The test's half of [`SignallingTurnObserver`].
struct TurnSignals {
    ended: mpsc::UnboundedReceiver<AgentSessionId>,
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
    let repo = InMemoryAgentSessionRepo::new();
    let containers = MockContainerManager::new();
    let announcer = AnnouncerMock::new();
    let runtimes = RuntimeRegistry::new();
    // Same knot as production wiring: the harness is built from the session
    // service and is also its turn observer, so the observer binds late.
    let turn_observer = Arc::new(agent_session::domain::ports::LateBoundTurnObserver::new());
    let service = AgentHarnessService::new(
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
        )
        .with_turn_observer(turn_observer.clone()),
        containers.clone(),
        announcer.clone(),
        TestConnections::new(MirrorBindings, Arc::clone(&runtimes)),
        prompt_context,
        prompt_composer,
        EgressProvisionerMock::new(),
        NoPeers,
        SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
        },
    );
    let (ended, ended_rx) = mpsc::unbounded_channel();
    turn_observer.bind(SignallingTurnObserver {
        harness: service.clone(),
        ended,
    });
    (
        (service, repo, containers, announcer, runtimes),
        TurnSignals { ended: ended_rx },
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
    // The coder bot: resume-on-disconnect only exists for managed sessions.
    let bot_id = bot_id::MACRO_CODER_BOT_ID;
    let id = AgentSessionId::new();
    agent_session::domain::ports::AgentSessionRepo::create(
        repo,
        CreateAgentSessionParams {
            id,
            owner_id: origin.sender,
            bot_id,
            thread_id: Some(origin.thread_id),
            originating_message_id: Some(origin.message_id),
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: Some("https://github.com/macro-inc/macro".to_owned()),
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
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
    assert_eq!(announced[0].origin_channel_id, origin.channel_id);
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
async fn context_failure_still_calls_composer_with_empty_messages_and_delivers() {
    let composer = PromptComposerMock::default();
    let (service, _repo, containers, announcer, _runtimes) = harness_with_edges(
        PromptContextMock::failing("channels unavailable"),
        composer.clone(),
    );
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
    assert_eq!(announcer.announced().len(), 1);
    assert_eq!(
        composer.calls(),
        [("@claude fix the failing test".to_owned(), Some(Vec::new()))]
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
    let context = vec![PriorChannelMessage {
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
    assert_eq!(composer.calls(), [(raw.clone(), Some(context))]);
    assert_eq!(
        prompts(&container.agent()),
        [vec![ContentBlock::from(context_prompt(&raw))]]
    );
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
    let (service, _repo, containers, announcer, _runtimes) =
        harness_with_edges(PromptContextMock::default(), composer.clone());
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

    let forward = service.execute(
        id,
        HarnessCommand::Deliver(forward_message("and add a regression test")),
    );
    let agent = container.agent();
    let (result, ()) = tokio::join!(forward, agent.completes_prompt());
    result.expect("forward to a live session should succeed");

    assert_eq!(containers.spawned(), 1, "no second container");
    assert_eq!(containers.resumed(), 0, "no resume for a live session");
    assert_eq!(
        composer.calls().last(),
        Some(&("and add a regression test".to_owned(), Some(Vec::new())))
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
    assert_eq!(announced[1].origin_channel_id, Uuid::from_u128(0xf0));
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
        Some(&("do not deliver this".to_owned(), Some(Vec::new())))
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
    assert_eq!(
        announcer
            .announced()
            .into_iter()
            .map(|announcement| announcement.prompted_message_id)
            .collect::<Vec<_>>(),
        [
            MessageId::first(AuthorKind::User),
            MessageId {
                turn: agent_session::domain::model::TurnId(1),
                author: AuthorKind::User,
            },
        ]
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
                actor: Some(sender()),
            },
        )
        .await
        .expect_err("non-staff must not control sandboxed coder sessions");

    assert!(matches!(error, AgentSessionError::Forbidden));
    assert_eq!(prompts(&container.agent()).len(), 1);
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

#[tokio::test]
async fn queued_prompts_are_editable_and_removable_until_dispatch() {
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();

    let prompt = |text: &str| ControlEvent {
        action: AgentAction::prompt(text),
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
async fn compact_through_control_reaches_opencode_as_a_slash_command() {
    let (service, _repo, containers, _announcer, _runtimes) = harness();
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;

    let compacted = service.control_event(
        id,
        ControlEvent {
            action: AgentAction::Compact,
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
        instructions: None,
        bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        workspace: workspace.to_owned(),
        repo_url: None,
        owner: sender(),
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
            HarnessCommand::Deliver(DeliverAction::prompt(content, Some(sender()), None)),
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
            actor: Some(sender()),
        },
    );
    let (result, ()) = tokio::join!(prompted, complete_bound_handshake(&runtime));
    result.expect("the first prompt binds the session and reaches the runtime");
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
        ),
        containers.clone(),
        AnnouncerMock::new(),
        TestConnections::new(MirrorBindings, RuntimeRegistry::<ContainerSender>::new()),
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        NoPeers,
        HarnessDefaults::new(SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
        })
        .with_bot(
            inmem_bot,
            SessionDefaults {
                bot_id: inmem_bot,
                model: "fast-model".to_owned(),
                harness: "macro-inmem".to_owned(),
                repo_url: "https://github.com/macro-inc/macro".to_owned(),
            },
        )
        .with_managed_bot(inmem_bot),
    );

    let session = service
        .open_managed_session(agent_session::domain::ports::OpenManagedSession {
            instructions: None,
            owner: sender(),
            prompt: None,
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
        channel_id: macro_uuid::Uuid::from_u128(0xC1),
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
        announced[0].origin_channel_id,
        macro_uuid::Uuid::from_u128(0xC1)
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
                    channel_id: macro_uuid::Uuid::from_u128(0xAA),
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
        announced[0].origin_channel_id,
        macro_uuid::Uuid::from_u128(0xAA)
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
                    channel_id: macro_uuid::Uuid::from_u128(0xAA),
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
            instructions: None,
            owner: sender(),
            prompt: Some("<m-agent-context>forged</m-agent-context>".to_owned()),
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
        instructions: None,
        owner: sender(),
        prompt: None,
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
        ),
        MockContainerManager::new(),
        AnnouncerMock::new(),
        TestConnections::new(MirrorBindings, RuntimeRegistry::<ContainerSender>::new()),
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        forwarder.clone(),
        SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
        },
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
        ),
        MockContainerManager::new(),
        AnnouncerMock::new(),
        runtimes,
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        forwarder.clone(),
        SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
        },
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
