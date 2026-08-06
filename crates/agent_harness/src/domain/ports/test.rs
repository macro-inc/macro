use std::sync::Arc;

use agent_client_protocol::schema::v1::{
    ClientRequest, ContentBlock, InitializeResponse, NewSessionResponse,
};
use agent_runtime_protocol::domain::action::AgentAction;
use agent_session::PROTOCOL_VERSION;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, CreateAgentSessionParams, Message};
use agent_session::domain::ports::AgentSessionLogRepo;
use agent_session::domain::service::{AgentSessionService, AgentSessionServiceImpl};
use agent_session::testing::InMemoryAgentSessionRepo;
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
    let sessions = Arc::new(AgentSessionServiceImpl::new(store.clone()));
    let containers = MockContainerManager::new();
    let container = containers
        .spawn(SpawnContainer {
            session_id: id,
            repo_url: "https://github.com/macro/macro".to_owned(),
        })
        .await
        .unwrap();
    let agent = container.agent();

    let record = sessions
        .create_session(params(id), container.clone())
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

#[tokio::test]
async fn attaching_a_second_transport_to_an_active_session_fails() {
    let id = AgentSessionId::TEST_A;
    let store = InMemoryAgentSessionRepo::new();
    let sessions = AgentSessionServiceImpl::new(store);
    let first = ContainerMock::default();
    let second = ContainerMock::default();

    sessions.create_session(params(id), first).await.unwrap();
    let error = sessions.attach_session(id, second).await.unwrap_err();

    assert!(matches!(error, AgentSessionError::AlreadyConnected(found) if found == id));
}
