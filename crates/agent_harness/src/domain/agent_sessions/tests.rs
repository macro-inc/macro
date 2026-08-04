use std::collections::VecDeque;

use agent_client_protocol::schema::v1::{
    ClientRequest, ContentBlock, InitializeResponse, NewSessionResponse,
};
use agent_runtime_protocol::domain::acp_id::AcpId;
use agent_runtime_protocol::domain::action::{AgentAction, AgentPromptAction};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use agent_session::domain::model::Message;
use agent_session::domain::model::{
    AgentSession as AgentSessionRecord, AgentSessionId, NewAgentSession,
    SessionStatus as RecordStatus,
};
use agent_session::domain::ports::MockAgentSessionRepo;
use bot_id::BotId;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;

use super::session::PendingAction;
use super::*;
use crate::domain::containers::{Container, ContainerManager};
use crate::testing::helpers::containers::MockContainerManager;
use crate::testing::helpers::log::LogRepoMock;

fn new_agent_session() -> NewAgentSession {
    NewAgentSession {
        created_from_thread_id: None,
        bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        model: "claude".to_owned(),
        harness: "opencode".to_owned(),
        repo_url: "https://github.com/macro/macro".to_owned(),
    }
}

fn record(id: AgentSessionId) -> AgentSessionRecord {
    AgentSessionRecord {
        id,
        created_from_thread_id: None,
        thread_id: macro_uuid::generate_uuid_v7(),
        bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        model: "claude".to_owned(),
        harness: "opencode".to_owned(),
        repo_url: "https://github.com/macro/macro".to_owned(),
        acp_session_id: None,
        status: RecordStatus::NoMessages,
        created_at: Utc::now(),
        modified_at: Utc::now(),
    }
}

/// The whole boot flow: an action arrives before the sandbox is up, waits out
/// the handshake, and reaches the agent once the ACP session exists.
#[tokio::test]
async fn a_queued_action_waits_for_the_handshake_then_reaches_the_agent() {
    let logs = LogRepoMock::new();

    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_create()
        .times(1)
        .returning(|_| Box::pin(async { Ok(record(AgentSessionId::TEST_A)) }));
    let manager = AgentSessionManager::new(sessions, logs.clone());

    // The row comes first: a link is named after the session it serves.
    let record = manager.create(new_agent_session()).await.unwrap();

    // Provisioning belongs to another crate; done by hand until it exists.
    let containers = MockContainerManager::new();
    let container = containers.spawn(record.id).await.unwrap();
    let agent = container.agent();

    let mut session = manager.plug(record.id, container.clone());

    // Queued while the sandbox boots: nothing reaches the agent.
    let asker = MacroUserIdStr::try_from_email("alice@example.com").unwrap();
    session
        .send_message(
            Some(asker.clone()),
            AgentAction::Prompt(AgentPromptAction {
                prompt: "fix the flaky test".to_owned(),
            }),
        )
        .await
        .unwrap();
    assert_eq!(session.status(), SessionStatus::Booting);
    assert_eq!(
        session.pending(),
        &VecDeque::from([PendingAction {
            from: Some(asker.clone()),
            action: AgentAction::Prompt(AgentPromptAction {
                prompt: "fix the flaky test".to_owned(),
            }),
        }])
    );
    assert!(agent.received_requests().is_empty());

    // Some other lifecycle event is not the go-ahead.
    container.sends_event(SystemEvent::Unknown("agent/starting".to_owned()));
    assert!(session.step().await.unwrap());
    assert_eq!(session.status(), SessionStatus::Booting);
    assert_eq!(
        session.pending(),
        &VecDeque::from([PendingAction {
            from: Some(asker.clone()),
            action: AgentAction::Prompt(AgentPromptAction {
                prompt: "fix the flaky test".to_owned(),
            }),
        }])
    );
    assert!(agent.received_requests().is_empty());

    // Ready means handshakeable, not sendable.
    container.sends_ready();
    assert!(session.step().await.unwrap());
    assert_eq!(session.status(), SessionStatus::Handshaking);
    assert_eq!(
        session.pending(),
        &VecDeque::from([PendingAction {
            from: Some(asker.clone()),
            action: AgentAction::Prompt(AgentPromptAction {
                prompt: "fix the flaky test".to_owned(),
            }),
        }])
    );
    assert!(matches!(
        agent.received_requests().as_slice(),
        [
            ClientRequest::InitializeRequest(_),
            ClientRequest::NewSessionRequest(_)
        ]
    ));

    // Answering initialize is not enough: there is still no ACP session id.
    agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
    assert!(session.step().await.unwrap());
    assert_eq!(session.status(), SessionStatus::Handshaking);
    assert_eq!(
        session.pending(),
        &VecDeque::from([PendingAction {
            from: Some(asker.clone()),
            action: AgentAction::Prompt(AgentPromptAction {
                prompt: "fix the flaky test".to_owned(),
            }),
        }])
    );
    assert!(matches!(
        agent.received_requests().as_slice(),
        [
            ClientRequest::InitializeRequest(_),
            ClientRequest::NewSessionRequest(_)
        ]
    ));

    // session/new answered: the id is recorded and the queue drains.
    agent.opens_session(NewSessionResponse::new("acp-abc"));
    assert!(session.step().await.unwrap());
    assert_eq!(session.status(), SessionStatus::Live);
    assert_eq!(session.acp_id(), Some(&AcpId::new("acp-abc")));
    assert!(session.pending().is_empty());
    let requests = agent.received_requests();
    let [
        ClientRequest::InitializeRequest(_),
        ClientRequest::NewSessionRequest(_),
        ClientRequest::PromptRequest(flushed),
    ] = requests.as_slice()
    else {
        panic!("expected the queued prompt to follow the handshake, got {requests:?}")
    };
    assert_eq!(flushed.session_id, AcpId::new("acp-abc").into());
    assert_eq!(
        flushed.prompt,
        vec![ContentBlock::from("fix the flaky test")]
    );

    // The user who asked is attributed on the log entry, even though the action
    // only reached the wire long after their request finished.
    let logged = logs.entries();
    let sent = logged
        .iter()
        .rev()
        .find(|entry| matches!(entry.content, Message::ToRuntime(_)))
        .expect("the flushed prompt was logged");
    assert_eq!(sent.user_id, Some(asker.clone()));

    // Live: no more queueing.
    session
        .send_message(
            None,
            AgentAction::Prompt(AgentPromptAction {
                prompt: "and run clippy".to_owned(),
            }),
        )
        .await
        .unwrap();
    let requests = agent.received_requests();
    let [
        ClientRequest::InitializeRequest(_),
        ClientRequest::NewSessionRequest(_),
        ClientRequest::PromptRequest(_),
        ClientRequest::PromptRequest(live),
    ] = requests.as_slice()
    else {
        panic!("expected a second prompt straight through, got {requests:?}")
    };
    assert_eq!(live.prompt, vec![ContentBlock::from("and run clippy")]);

    // Both directions were logged, in wire order.
    assert_eq!(logs.entries().len(), 8);

    // The sandbox went away.
    container.disconnects();
    assert!(!session.step().await.unwrap());
    assert_eq!(session.status(), SessionStatus::Dead);
    assert!(
        session
            .send_message(
                None,
                AgentAction::Prompt(AgentPromptAction {
                    prompt: "too late".to_owned(),
                })
            )
            .await
            .is_err()
    );
}

/// Reattaching must hand back the sandbox that already exists, not a new one:
/// a fresh sandbox would discard the agent's workspace.
#[tokio::test]
async fn resuming_reuses_the_sandbox_the_session_already_has() {
    let session_id = AgentSessionId::TEST_A;
    let containers = MockContainerManager::new();

    let spawned = containers.spawn(session_id).await.unwrap();
    let resumed = containers.resume(session_id).await.unwrap();

    assert_eq!(resumed.container_id(), spawned.container_id());
    assert_eq!(containers.spawned(), 1);
}

#[tokio::test]
async fn resuming_a_session_that_never_had_a_sandbox_fails() {
    let containers = MockContainerManager::new();
    assert!(containers.resume(AgentSessionId::TEST_B).await.is_err());
}

/// The path in Rust and the path the container's boot script clones into must
/// agree; nothing else keeps them in step.
#[test]
fn the_workspace_matches_the_container_script() {
    let script = include_str!("../../../container/ensure_ready.sh");
    assert!(
        script.contains(&format!("workspace_dir={WORKSPACE}")),
        "ensure_ready.sh does not clone into {WORKSPACE}"
    );
}

/// A flush that dies part-way must leave the rest queued, not drop it.
#[tokio::test]
async fn a_failed_flush_strands_the_remainder() {
    let logs = LogRepoMock::new();
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_create()
        .returning(|_| Box::pin(async { Ok(record(AgentSessionId::TEST_A)) }));
    let manager = AgentSessionManager::new(sessions, logs.clone());

    let record = manager.create(new_agent_session()).await.unwrap();
    let containers = MockContainerManager::new();
    let container = containers.spawn(record.id).await.unwrap();
    let agent = container.agent();
    let mut session = manager.plug(record.id, container.clone());

    for text in ["first", "second", "third"] {
        session
            .send_message(
                None,
                AgentAction::Prompt(AgentPromptAction {
                    prompt: text.to_owned(),
                }),
            )
            .await
            .unwrap();
    }

    container.sends_ready();
    session.step().await.unwrap();

    // Two prompts get through, the third does not.
    container.fails_sends_after(2);
    agent.opens_session(NewSessionResponse::new("acp-abc"));
    assert!(session.step().await.is_err());

    assert_eq!(session.pending().len(), 1);
    assert_eq!(
        session.pending()[0].action,
        AgentAction::Prompt(AgentPromptAction {
            prompt: "third".to_owned(),
        })
    );

    // A later action flushes the stranded one first, so ordering holds.
    container.fails_sends_after(usize::MAX);
    session
        .send_message(
            None,
            AgentAction::Prompt(AgentPromptAction {
                prompt: "fourth".to_owned(),
            }),
        )
        .await
        .unwrap();
    assert!(session.pending().is_empty());

    let requests = agent.received_requests();
    let prompts: Vec<_> = requests
        .iter()
        .filter_map(|request| match request {
            ClientRequest::PromptRequest(prompt) => Some(prompt.prompt.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(
        prompts,
        ["first", "second", "third", "fourth"]
            .map(|text| vec![ContentBlock::from(text)])
            .to_vec()
    );
}

/// An agent that refuses `session/new` leaves a dead session, not one wedged in
/// `Handshaking` forever.
#[tokio::test]
async fn a_refused_handshake_kills_the_session() {
    let logs = LogRepoMock::new();
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_create()
        .returning(|_| Box::pin(async { Ok(record(AgentSessionId::TEST_A)) }));
    let manager = AgentSessionManager::new(sessions, logs.clone());

    let record = manager.create(new_agent_session()).await.unwrap();
    let containers = MockContainerManager::new();
    let container = containers.spawn(record.id).await.unwrap();
    let agent = container.agent();
    let mut session = manager.plug(record.id, container.clone());

    container.sends_ready();
    session.step().await.unwrap();
    assert_eq!(session.status(), SessionStatus::Handshaking);

    agent.refuses_session(agent_client_protocol::Error::internal_error());
    assert!(session.step().await.is_err());

    assert_eq!(session.status(), SessionStatus::Dead);
    assert!(
        session
            .send_message(
                None,
                AgentAction::Prompt(AgentPromptAction {
                    prompt: "too late".to_owned(),
                }),
            )
            .await
            .is_err()
    );
}
