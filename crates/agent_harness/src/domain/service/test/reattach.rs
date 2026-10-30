//! A runtime that dials in again reports the sessions its agents still serve,
//! and the harness loads them without anyone prompting.

use super::*;
use agent_client_protocol::schema::v1::LoadSessionResponse;

/// A session the runtime had opened before its connection dropped. Its ACP
/// session id is its own id, which is how [`MirrorBindings`] resolves it.
async fn native_session(
    service: &TestHarness,
    repo: &InMemoryAgentSessionRepo,
    bot_id: BotId,
) -> AgentSessionId {
    let mut request = open_external_request("/srv/agent");
    request.bot_id = bot_id;
    let session = service.open_external_session(request).await.unwrap();
    repo.set_acp_session_id(session.id, SessionId::new(session.id.to_string()))
        .await
        .unwrap();
    session.id
}

/// Initialize the connection for an agent that can load sessions.
async fn initializes_loading(runtime: &ContainerMock) {
    let agent = runtime.agent();
    runtime.sends_ready();
    agent.wait_for_requests(1).await;
    agent.completes_initialize(
        InitializeResponse::new(PROTOCOL_VERSION)
            .agent_capabilities(AgentCapabilities::new().load_session(true)),
    );
}

/// The ACP sessions the harness asked this agent to load, in order.
fn loaded(agent: &FakeAgent) -> Vec<String> {
    agent
        .received_requests()
        .into_iter()
        .filter_map(|request| match request {
            ClientRequest::LoadSessionRequest(load) => Some(load.session_id.to_string()),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn a_redial_loads_a_live_session_without_a_prompt() {
    let (service, repo, containers, _announcer, runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let session = native_session(&service, &repo, bot_id).await;
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), runtime.clone());

    let drive = async {
        initializes_loading(&runtime).await;
        let agent = runtime.agent();
        agent.wait_for_requests(2).await;
        agent.loads_session(LoadSessionResponse::new());
    };
    tokio::join!(
        service.reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![SessionId::new(session.to_string())]
        ),
        drive
    );

    let agent = runtime.agent();
    assert_eq!(loaded(&agent), [session.to_string()]);
    assert!(prompts(&agent).is_empty(), "reattaching never prompts");
    assert_eq!(containers.spawned(), 0);
    assert_eq!(containers.resumed(), 0);

    // The runtime reports the same session again, as a retry would: the
    // attached session keeps its actor and nothing reaches the agent.
    service
        .reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![SessionId::new(session.to_string())],
        )
        .await;
    assert_eq!(agent.received_requests().len(), 2);
}

#[tokio::test]
async fn a_redial_loads_every_live_session_but_not_archived_or_unknown_ones() {
    let (service, repo, _containers, _announcer, runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let first = native_session(&service, &repo, bot_id).await;
    let second = native_session(&service, &repo, bot_id).await;
    let archived = native_session(&service, &repo, bot_id).await;
    agent_session::domain::ports::AgentSessionRepo::set_archived(&repo, archived, true)
        .await
        .unwrap();
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), runtime.clone());

    let drive = async {
        initializes_loading(&runtime).await;
        let agent = runtime.agent();
        agent.wait_for_requests(3).await;
        for frame in agent.received_frames() {
            if let RawJsonRpcMessage::Request(request) = frame
                && request.method.as_ref() == "session/load"
            {
                agent.sends_reply(request.id, LoadSessionResponse::new());
            }
        }
    };
    tokio::join!(
        service.reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![
                SessionId::new(first.to_string()),
                SessionId::new(second.to_string()),
                SessionId::new(archived.to_string()),
                SessionId::new(AgentSessionId::new().to_string()),
            ]
        ),
        drive
    );

    let mut loaded = loaded(&runtime.agent());
    loaded.sort();
    let mut expected = vec![first.to_string(), second.to_string()];
    expected.sort();
    assert_eq!(loaded, expected);
}

#[tokio::test]
async fn a_live_session_on_a_runtime_that_is_gone_is_left_for_the_next_dial() {
    let (service, repo, _containers, _announcer, _runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let session = native_session(&service, &repo, bot_id).await;

    // The report raced the connection's end: nothing is attached and the
    // session stays reattachable when the runtime dials again.
    service
        .reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![SessionId::new(session.to_string())],
        )
        .await;
    assert!(
        agent_session::domain::service::AgentSessionService::attached_mcp_servers(
            &service.inner.sessions,
            session
        )
        .is_none()
    );
}
