use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    ClientRequest, ContentBlock, InitializeResponse, NewSessionResponse,
};
use agent_runtime_protocol::domain::action::{AgentAction, AgentPromptAction};
use agent_session::domain::model::{
    AgentSession, AgentSessionId, CreateAgentSessionParams, SessionStatus,
};
use agent_session::domain::ports::MockAgentSessionRepo;
use bot_id::BotId;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;

use super::AgentHarnessService;
use crate::domain::agent_sessions::PROTOCOL_VERSION;
use crate::domain::containers::{Container, ContainerManager};
use crate::testing::helpers::agent::FakeAgent;
use crate::testing::helpers::containers::{ContainerMock, MockContainerManager};
use crate::testing::helpers::log::LogRepoMock;

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

fn record(id: AgentSessionId) -> AgentSession {
    AgentSession {
        id,
        channel_id: macro_uuid::generate_uuid_v7(),
        thread_id: None,
        originating_message_id: None,
        bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        model: "claude".to_owned(),
        harness: "opencode".to_owned(),
        repo_url: "https://github.com/macro/macro".to_owned(),
        acp_session_id: None,
        status: SessionStatus::NoMessages,
        created_at: Utc::now(),
        modified_at: Utc::now(),
    }
}

fn prompt(text: &str) -> AgentAction {
    AgentAction::Prompt(AgentPromptAction {
        prompt: text.to_owned(),
    })
}

async fn wait_for_requests(agent: &FakeAgent, count: usize) {
    tokio::time::timeout(Duration::from_secs(1), async {
        while agent.received_requests().len() < count {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("agent did not receive requests in time");
}

async fn wait_for_container(
    containers: &MockContainerManager,
    id: AgentSessionId,
) -> ContainerMock {
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let Some(container) = containers.container(id) {
                break container;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("container was not created in time")
}

async fn complete_handshake(container: &ContainerMock) {
    let agent = container.agent();
    let previous_requests = agent.received_requests().len();
    container.sends_ready();
    wait_for_requests(&agent, previous_requests + 2).await;
    agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
    agent.opens_session(NewSessionResponse::new("acp-service-test"));
}

fn prompt_texts(agent: &FakeAgent) -> Vec<Vec<ContentBlock>> {
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
async fn start_runs_the_first_action_end_to_end() {
    let id = AgentSessionId::TEST_A;
    let expected = record(id);
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_create().times(1).returning(move |_| {
        let expected = expected.clone();
        Box::pin(async move { Ok(expected) })
    });
    let logs = LogRepoMock::new();
    let containers = MockContainerManager::new();
    let service = AgentHarnessService::new(sessions, logs.clone(), containers.clone());

    let start = service.start(params(id), Some(owner()), prompt("fix the flaky test"));
    let drive_agent = async {
        let container = wait_for_container(&containers, id).await;
        let agent = container.agent();
        complete_handshake(&container).await;
        wait_for_requests(&agent, 3).await;
        agent
    };
    let (started, agent) = tokio::join!(start, drive_agent);
    let started = started.unwrap();
    assert_eq!(started, id);
    assert_eq!(containers.spawned(), 1);
    assert_eq!(containers.resumed(), 0);

    assert_eq!(
        prompt_texts(&agent),
        vec![vec![ContentBlock::from("fix the flaky test")]]
    );
    assert!(
        logs.entries().iter().any(|entry| {
            entry.agent_session_id == id && entry.user_id.as_ref() == Some(&owner())
        })
    );
}

#[tokio::test]
async fn send_to_an_inactive_session_resumes_its_container() {
    let id = AgentSessionId::TEST_A;
    let expected = record(id);
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_get().times(1).returning(move |_| {
        let expected = expected.clone();
        Box::pin(async move { Ok(expected) })
    });
    let logs = LogRepoMock::new();
    let containers = MockContainerManager::new();
    let original = containers.spawn(id).await.unwrap();
    let service = AgentHarnessService::new(sessions, logs, containers.clone());

    let send = service.send(id, Some(owner()), prompt("continue the work"));
    let drive_agent = async {
        complete_handshake(&original).await;
        let agent = original.agent();
        wait_for_requests(&agent, 3).await;
        agent
    };
    let (sent, agent) = tokio::join!(send, drive_agent);
    sent.unwrap();

    assert_eq!(containers.spawned(), 1);
    assert_eq!(containers.resumed(), 1);
    let resumed = containers.container(id).expect("resumed container");
    assert_eq!(resumed.container_id(), original.container_id());
    assert_eq!(
        prompt_texts(&agent),
        vec![vec![ContentBlock::from("continue the work")]]
    );
}

#[tokio::test]
async fn concurrent_cold_sends_resume_only_once() {
    let id = AgentSessionId::TEST_A;
    let expected = record(id);
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_get().times(1).returning(move |_| {
        let expected = expected.clone();
        Box::pin(async move { Ok(expected) })
    });
    let logs = LogRepoMock::new();
    let containers = MockContainerManager::new();
    containers.spawn(id).await.unwrap();
    let service = AgentHarnessService::new(sessions, logs, containers.clone());

    let sends = async {
        tokio::join!(
            service.send(id, Some(owner()), prompt("first")),
            service.send(id, Some(owner()), prompt("second")),
        )
    };
    let drive_agent = async {
        let container = containers.container(id).expect("resumed container");
        complete_handshake(&container).await;
        let agent = container.agent();
        wait_for_requests(&agent, 4).await;
        agent
    };
    let ((first, second), agent) = tokio::join!(sends, drive_agent);
    first.unwrap();
    second.unwrap();

    assert_eq!(containers.resumed(), 1);
    assert_eq!(
        prompt_texts(&agent),
        ["first", "second"]
            .map(|text| vec![ContentBlock::from(text)])
            .to_vec()
    );
}

#[tokio::test]
async fn a_failed_active_send_is_retired_before_the_next_send() {
    let id = AgentSessionId::TEST_A;
    let created = record(id);
    let resumed = created.clone();
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_create().times(1).returning(move |_| {
        let created = created.clone();
        Box::pin(async move { Ok(created) })
    });
    sessions.expect_get().times(1).returning(move |_| {
        let resumed = resumed.clone();
        Box::pin(async move { Ok(resumed) })
    });
    let logs = LogRepoMock::new();
    let containers = MockContainerManager::new();
    let service = AgentHarnessService::new(sessions, logs, containers.clone());

    let start = service.start(params(id), Some(owner()), prompt("initial"));
    let drive_agent = async {
        let container = wait_for_container(&containers, id).await;
        complete_handshake(&container).await;
        let agent = container.agent();
        wait_for_requests(&agent, 3).await;
        (container, agent)
    };
    let (started, (container, agent)) = tokio::join!(start, drive_agent);
    started.unwrap();

    container.fails_sends_after(0);
    assert!(
        service
            .send(id, Some(owner()), prompt("fails"))
            .await
            .is_err()
    );

    container.fails_sends_after(usize::MAX);
    let send = service.send(id, Some(owner()), prompt("after resume"));
    let drive_agent = async {
        complete_handshake(&container).await;
        wait_for_requests(&agent, 6).await;
    };
    let (sent, ()) = tokio::join!(send, drive_agent);
    sent.unwrap();
    assert_eq!(containers.resumed(), 1);

    assert_eq!(
        prompt_texts(&agent),
        ["initial", "after resume"]
            .map(|text| vec![ContentBlock::from(text)])
            .to_vec()
    );
}

#[tokio::test]
async fn a_partial_boot_flush_only_fails_actions_not_delivered() {
    let id = AgentSessionId::TEST_A;
    let expected = record(id);
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_create().times(1).returning(move |_| {
        let expected = expected.clone();
        Box::pin(async move { Ok(expected) })
    });
    let logs = LogRepoMock::new();
    let containers = MockContainerManager::new();
    let service = Arc::new(AgentHarnessService::new(sessions, logs, containers.clone()));

    let first = tokio::spawn({
        let service = service.clone();
        async move {
            service
                .start(params(id), Some(owner()), prompt("first"))
                .await
        }
    });
    let container = wait_for_container(&containers, id).await;
    let second = tokio::spawn({
        let service = service.clone();
        async move { service.send(id, Some(owner()), prompt("second")).await }
    });
    let third = tokio::spawn({
        let service = service.clone();
        async move { service.send(id, Some(owner()), prompt("third")).await }
    });

    // Let all three commands enter the booting session before making ACP ready.
    for _ in 0..3 {
        tokio::task::yield_now().await;
    }
    let agent = container.agent();
    container.sends_ready();
    wait_for_requests(&agent, 2).await;
    agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
    container.fails_sends_after(1);
    agent.opens_session(NewSessionResponse::new("acp-partial-flush"));

    assert_eq!(first.await.unwrap().unwrap(), id);
    assert!(second.await.unwrap().is_err());
    assert!(third.await.unwrap().is_err());
    assert_eq!(
        prompt_texts(&agent),
        vec![vec![ContentBlock::from("first")]]
    );
}
