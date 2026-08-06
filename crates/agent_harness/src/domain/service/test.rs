//! Integration tests: the real orchestrator over the real session service,
//! with in-memory persistence, mock containers, a fake agent, and a
//! recording announcer. Only the edges are doubles.

use agent_client_protocol::schema::v1::{
    ClientRequest, ContentBlock, InitializeResponse, NewSessionResponse,
};
use agent_session::PROTOCOL_VERSION;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::AgentSessionRepo as _;
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::testing::InMemoryAgentSessionRepo;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;

use super::AgentHarnessService;
use crate::domain::error::HarnessError;
use crate::domain::model::{ForwardMessage, MentionOrigin, OpenSession, SessionDefaults};
// Cold-session resume is `todo!()` in `forward` for now; its tests return
// with the implementation.
use crate::testing::helpers::agent::FakeAgent;
use crate::testing::helpers::announcer::AnnouncerMock;
use crate::testing::helpers::containers::{ContainerMock, MockContainerManager};

fn sender() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("asker@example.com").expect("a valid user id")
}

fn open_command() -> OpenSession {
    let thread_id = macro_uuid::generate_uuid_v7();
    OpenSession {
        bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        origin: MentionOrigin {
            channel_id: macro_uuid::generate_uuid_v7(),
            thread_id,
            message_id: thread_id,
            sender: sender(),
            content: "@claude fix the failing test".to_owned(),
        },
    }
}

fn harness() -> (
    AgentHarnessService<
        AgentSessionServiceImpl<InMemoryAgentSessionRepo>,
        MockContainerManager,
        AnnouncerMock,
    >,
    InMemoryAgentSessionRepo,
    MockContainerManager,
    AnnouncerMock,
) {
    let repo = InMemoryAgentSessionRepo::new();
    let containers = MockContainerManager::new();
    let announcer = AnnouncerMock::new();
    let service = AgentHarnessService::new(
        AgentSessionServiceImpl::new(repo.clone()),
        containers.clone(),
        announcer.clone(),
        SessionDefaults {
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
        },
    );
    (service, repo, containers, announcer)
}

/// Play the agent's half of the ACP handshake.
async fn complete_handshake(container: &ContainerMock) {
    let agent = container.agent();
    let already = agent.received_requests().len();
    container.sends_ready();
    agent.wait_for_requests(already + 1).await;
    agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
    agent.wait_for_requests(already + 2).await;
    agent.opens_session(NewSessionResponse::new("acp-test"));
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

#[tokio::test]
async fn open_creates_announces_and_delivers_the_mention() {
    let (service, repo, containers, announcer) = harness();
    let command = open_command();
    let origin = command.origin.clone();

    let open = service.open(command);
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
    let id = opened.expect("open should succeed");

    // The row exists, carries the origin, and was announced with its real
    // dedicated channel id.
    let session = repo.get(id).await.expect("the session row exists");
    assert_eq!(session.originating_message_id, Some(origin.message_id));
    assert_eq!(session.thread_id, Some(origin.thread_id));
    let announced = announcer.announced();
    assert_eq!(announced.len(), 1);
    assert_eq!(announced[0].session_channel_id, session.channel_id);
    assert_eq!(announced[0].origin_channel_id, origin.channel_id);
    assert_eq!(announced[0].origin_thread_id, origin.thread_id);
    assert_eq!(announced[0].triggered_by, origin.sender);

    // The mention's text reached the agent as the first prompt.
    assert_eq!(
        prompts(&container.agent()),
        [vec![ContentBlock::from("@claude fix the failing test")]]
    );
}

#[tokio::test]
async fn open_announces_before_the_prompt_is_delivered() {
    let (service, _repo, containers, announcer) = harness();

    let open = service.open(open_command());
    let observed = async {
        // The announcement lands while the container is still booting - the
        // handshake has not even started, so the prompt cannot have been
        // delivered yet.
        loop {
            if !announcer.announced().is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(&containers))
            .expect("the spawned container is findable");
        let prompts_at_announce = prompts(&container.agent()).len();
        complete_handshake(&container).await;
        prompts_at_announce
    };
    let (opened, prompts_at_announce) = tokio::join!(open, observed);
    opened.expect("open should succeed");

    assert_eq!(
        prompts_at_announce, 0,
        "the announcement should not wait for prompt delivery"
    );
}

#[tokio::test]
async fn forward_to_a_live_session_reuses_the_transport() {
    let (service, _repo, containers, _announcer) = harness();
    let open = service.open(open_command());
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
    let id = opened.expect("open should succeed");

    service
        .forward(ForwardMessage {
            session_id: id,
            sender: Some(sender()),
            content: "and add a regression test".to_owned(),
        })
        .await
        .expect("forward to a live session should succeed");

    assert_eq!(containers.spawned(), 1, "no second container");
    assert_eq!(containers.resumed(), 0, "no resume for a live session");
    assert_eq!(prompts(&container.agent()).len(), 2);
}

#[tokio::test]
async fn a_failed_announce_surfaces_and_no_prompt_is_delivered() {
    let (service, repo, containers, announcer) = harness();
    announcer.fails("comms is down");

    let result = service.open(open_command()).await;

    assert!(matches!(result, Err(HarnessError::Announce(_))));
    // The session row and container exist - the failure is the announcement,
    // not the session - but the mention was never delivered to the agent.
    assert_eq!(containers.spawned(), 1);
    let container = containers
        .container(session_of(&containers))
        .expect("the spawned container is findable");
    assert!(prompts(&container.agent()).is_empty());
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
