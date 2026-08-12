use std::sync::Arc;

use agent_client_protocol::schema::v1::{
    ClientRequest, ContentBlock, InitializeResponse, NewSessionResponse,
};
use agent_fold::domain::service::FoldedMessageService;
use agent_runtime_protocol::domain::action::AgentAction;
use agent_session::PROTOCOL_VERSION;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, CreateAgentSessionParams, Message};
use agent_session::domain::ports::{AgentSessionLogRepo, NoOpRealtime};
use agent_session::domain::service::{AgentSessionService, AgentSessionServiceImpl};
use agent_session::testing::{InMemoryAgentSessionRepo, RecordingComms};
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;

use super::ContainerManager;
use crate::domain::model::SpawnContainer;
use crate::testing::helpers::containers::{ContainerMock, MockContainerManager};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn params(id: AgentSessionId) -> CreateAgentSessionParams {
    CreateAgentSessionParams {
        id,
        owner_id: owner(),
        bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        thread_id: None,
        originating_message_id: None,
        model: "claude".to_owned(),
        harness: "opencode".to_owned(),
        repo_url: "https://github.com/macro/macro".to_owned(),
    }
}

fn prompt_texts(container: &ContainerMock) -> Vec<Vec<ContentBlock>> {
    container
        .agent()
        .received_requests()
        .into_iter()
        .filter_map(|request| match request {
            ClientRequest::PromptRequest(prompt) => Some(prompt.prompt),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn container_session_runs_and_logs_end_to_end() {
    let id = AgentSessionId::TEST_A;
    let store = InMemoryAgentSessionRepo::new();
    let sessions = Arc::new(AgentSessionServiceImpl::new(
        store.clone(),
        FoldedMessageService::new(store.clone()),
        RecordingComms::new(),
        NoOpRealtime,
    ));
    let containers = MockContainerManager::new();
    let container = containers
        .spawn(SpawnContainer {
            session_id: id,
            repo_url: "https://github.com/macro/macro".to_owned(),
        })
        .await
        .unwrap();
    let agent = container.agent();

    let record = sessions.create_session(params(id)).await.unwrap();
    sessions
        .attach_session(id, container.clone())
        .await
        .unwrap();
    assert_eq!(record.id, id);
    assert_eq!(containers.spawned(), 1);
    assert!(agent.received_requests().is_empty());

    let send = tokio::spawn({
        let sessions = sessions.clone();
        async move {
            sessions
                .send_action(id, Some(owner()), AgentAction::prompt("fix the flaky test"))
                .await
        }
    });

    container.sends_ready();
    agent.wait_for_requests(1).await;
    agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
    agent.wait_for_requests(2).await;
    agent.opens_session(NewSessionResponse::new("acp-container-test"));
    agent.wait_for_requests(3).await;
    send.await.unwrap().unwrap();

    assert_eq!(
        prompt_texts(&container),
        vec![vec![ContentBlock::from("fix the flaky test")]]
    );

    let logs = store.list_by_session(id).await.unwrap();
    assert_eq!(logs.len(), 6);
    assert!(matches!(logs[0].content, Message::ToServer(_)));
    assert!(matches!(logs[1].content, Message::ToRuntime(_)));
    assert!(matches!(logs[2].content, Message::ToServer(_)));
    assert!(matches!(logs[3].content, Message::ToRuntime(_)));
    assert!(matches!(logs[4].content, Message::ToServer(_)));
    assert!(matches!(logs[5].content, Message::ToRuntime(_)));
    assert_eq!(logs[5].user_id, Some(owner()));

    sessions
        .send_action(id, Some(owner()), AgentAction::prompt("and run clippy"))
        .await
        .unwrap();
    assert_eq!(containers.spawned(), 1);
    assert_eq!(containers.resumed(), 0);
    assert_eq!(
        prompt_texts(&container),
        ["fix the flaky test", "and run clippy"]
            .map(|text| vec![ContentBlock::from(text)])
            .to_vec()
    );
}

/// A live session's log is written by its actor, not through
/// `append_event`, so the placeholder sync has to hang off that path too -
/// otherwise a connected session streams frames into its log while its
/// channel stays empty.
#[tokio::test]
async fn a_live_sessions_frames_place_holders_in_its_channel() {
    let id = AgentSessionId::TEST_A;
    let store = InMemoryAgentSessionRepo::new();
    let comms = RecordingComms::new();
    let sessions = Arc::new(AgentSessionServiceImpl::new(
        store.clone(),
        FoldedMessageService::new(store.clone()),
        comms.clone(),
        NoOpRealtime,
    ));
    let containers = MockContainerManager::new();
    let container = containers
        .spawn(SpawnContainer {
            session_id: id,
            repo_url: "https://github.com/macro/macro".to_owned(),
        })
        .await
        .unwrap();
    let agent = container.agent();

    let record = sessions.create_session(params(id)).await.unwrap();
    sessions
        .attach_session(id, container.clone())
        .await
        .unwrap();
    assert!(
        comms.created().is_empty(),
        "a session with an empty log folds to nothing"
    );

    let send = tokio::spawn({
        let sessions = sessions.clone();
        async move {
            sessions
                .send_action(id, Some(owner()), AgentAction::prompt("fix the flaky test"))
                .await
        }
    });

    container.sends_ready();
    agent.wait_for_requests(1).await;
    agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
    agent.wait_for_requests(2).await;
    agent.opens_session(NewSessionResponse::new("acp-placeholder-test"));
    agent.wait_for_requests(3).await;

    // Delivery completes only after the prompt's log write, and the sync runs
    // inside that write - so there is nothing to wait on here.
    send.await.unwrap().unwrap();

    let created = comms.created();
    assert!(
        !created.is_empty(),
        "the prompt the actor logged should have produced a placeholder"
    );
    assert!(
        created
            .iter()
            .all(|(channel, _)| *channel == record.channel_id),
        "placeholders belong to the session's dedicated channel"
    );
}

#[tokio::test]
async fn attaching_a_second_transport_to_an_active_session_fails() {
    let id = AgentSessionId::TEST_A;
    let store = InMemoryAgentSessionRepo::new();
    let sessions = AgentSessionServiceImpl::new(
        store.clone(),
        FoldedMessageService::new(store),
        RecordingComms::new(),
        NoOpRealtime,
    );
    let first = ContainerMock::default();
    let second = ContainerMock::default();

    sessions.create_session(params(id)).await.unwrap();
    sessions.attach_session(id, first).await.unwrap();
    let error = sessions.attach_session(id, second).await.unwrap_err();

    assert!(matches!(error, AgentSessionError::AlreadyConnected(found) if found == id));
}
