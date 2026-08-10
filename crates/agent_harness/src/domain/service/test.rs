//! Integration tests: the real orchestrator over the real session service,
//! with in-memory persistence, mock containers, a fake agent, and a
//! recording announcer. Only the edges are doubles.

use agent_client_protocol::schema::v1::{
    AgentCapabilities, ClientRequest, ContentBlock, InitializeResponse, NewSessionResponse,
    ResumeSessionResponse, SessionCapabilities, SessionId, SessionResumeCapabilities,
};
use agent_fold::domain::service::FoldedMessageService;
use agent_session::PROTOCOL_VERSION;
use agent_session::domain::model::{AgentSessionId, CreateAgentSessionParams, Message};
use agent_session::domain::ports::{AgentSessionLogRepo as _, AgentSessionRepo as _};
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::testing::{InMemoryAgentSessionRepo, RecordingComms};
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;

use super::AgentHarnessService;
use crate::domain::error::HarnessError;
use crate::domain::model::{
    ForwardMessage, HarnessCommand, MentionOrigin, OpenSession, SessionDefaults, SpawnContainer,
};
use crate::domain::ports::ContainerManager as _;
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
        AgentSessionServiceImpl<
            InMemoryAgentSessionRepo,
            FoldedMessageService<InMemoryAgentSessionRepo>,
            RecordingComms,
        >,
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
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            RecordingComms::new(),
        ),
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
    let OpenSession { bot_id, origin } = open_command();
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
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
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
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
        })
        .await
        .expect("the original sandbox should exist");
    id
}

#[tokio::test]
async fn open_creates_announces_and_delivers_the_mention() {
    let (service, repo, containers, announcer) = harness();
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

    // The row exists, carries the origin, and was announced with its real
    // dedicated channel id.
    let session = repo.get(id).await.expect("the session row exists");
    assert_eq!(session.acp_session_id.as_deref(), Some("acp-test"));
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
    let id = AgentSessionId::new();

    let open = service.execute(id, HarnessCommand::Open(open_command()));
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

    service
        .execute(
            id,
            HarnessCommand::Forward(ForwardMessage {
                sender: Some(sender()),
                content: "and add a regression test".to_owned(),
            }),
        )
        .await
        .expect("forward to a live session should succeed");

    assert_eq!(containers.spawned(), 1, "no second container");
    assert_eq!(containers.resumed(), 0, "no resume for a live session");
    assert_eq!(prompts(&container.agent()).len(), 2);
}

#[tokio::test]
async fn a_delivery_failure_is_not_automatically_resumed() {
    let (service, _repo, containers, _announcer) = harness();
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
    container.fails_sends_after(0);

    let result = service
        .execute(
            id,
            HarnessCommand::Forward(ForwardMessage {
                sender: Some(sender()),
                content: "do not retry this".to_owned(),
            }),
        )
        .await;

    assert!(matches!(result, Err(HarnessError::Session(_))));
    assert_eq!(containers.resumed(), 0);
}

#[tokio::test]
async fn forward_to_a_disconnected_session_resumes_acp_and_delivers_the_prompt() {
    let (service, repo, containers, _announcer) = harness();
    let id = disconnected_session(&repo, &containers).await;

    let forward = service.execute(
        id,
        HarnessCommand::Forward(ForwardMessage {
            sender: Some(sender()),
            content: "continue after reconnecting".to_owned(),
        }),
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
        [vec![ContentBlock::from("continue after reconnecting")]]
    );
    let prompt_logs = repo
        .list_by_session(id)
        .await
        .expect("session logs should be readable")
        .into_iter()
        .filter(|log| {
            matches!(
                &log.content,
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
    let (service, repo, containers, _announcer) = harness();
    let id = disconnected_session(&repo, &containers).await;
    let first = service.execute(
        id,
        HarnessCommand::Forward(ForwardMessage {
            sender: Some(sender()),
            content: "first".to_owned(),
        }),
    );
    let second = service.execute(
        id,
        HarnessCommand::Forward(ForwardMessage {
            sender: Some(sender()),
            content: "second".to_owned(),
        }),
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
        resumed.agent().wait_for_requests(4).await;
        resumed
    };

    let (first, second, resumed) = tokio::join!(first, second, drive_resume);

    first.expect("the first message should be delivered");
    second.expect("the second message should be delivered");
    assert_eq!(containers.resumed(), 1);
    assert_eq!(
        prompts(&resumed.agent()),
        [
            vec![ContentBlock::from("first")],
            vec![ContentBlock::from("second")],
        ]
    );
}

#[tokio::test]
async fn different_sessions_execute_concurrently() {
    let (service, repo, containers, _announcer) = harness();
    let first_id = disconnected_session(&repo, &containers).await;
    let second_id = disconnected_session(&repo, &containers).await;
    let first = service.execute(
        first_id,
        HarnessCommand::Forward(ForwardMessage {
            sender: Some(sender()),
            content: "first".to_owned(),
        }),
    );
    let second = service.execute(
        second_id,
        HarnessCommand::Forward(ForwardMessage {
            sender: Some(sender()),
            content: "second".to_owned(),
        }),
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
    let (service, repo, containers, _announcer) = harness();
    let id = disconnected_session(&repo, &containers).await;
    let completion = service.execute(
        id,
        HarnessCommand::Forward(ForwardMessage {
            sender: Some(sender()),
            content: "finish even when nobody is waiting".to_owned(),
        }),
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
        [vec![ContentBlock::from(
            "finish even when nobody is waiting"
        )]]
    );
}

#[tokio::test]
async fn a_failed_announce_surfaces_and_no_prompt_is_delivered() {
    let (service, repo, containers, announcer) = harness();
    announcer.fails("comms is down");

    let result = service
        .execute(AgentSessionId::new(), HarnessCommand::Open(open_command()))
        .await;

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
