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
            vec![SessionId::new(session.to_string())],
            tracing::Span::none(),
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
            tracing::Span::none(),
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
            ],
            tracing::Span::none(),
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
async fn a_redial_reopens_sessions_an_idle_teardown_closed() {
    let (service, repo, _containers, _announcer, runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let first = native_session(&service, &repo, bot_id).await;
    let second = native_session(&service, &repo, bot_id).await;
    for session in [first, second] {
        service.inner.sessions.mark_disconnected(session).await.unwrap();
    }
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), runtime.clone());

    // One session runs the handshake; the other opens on its result.
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
            ],
            tracing::Span::none(),
        ),
        drive
    );

    // Egress and the internal MCP honor a session's token only while its row
    // is open, so both must have reopened before their MCP servers are dialed.
    for session in [first, second] {
        let row = agent_session::domain::ports::AgentSessionRepo::get(&repo, session)
            .await
            .unwrap();
        agent_session::domain::credentials::open_session(row)
            .unwrap_or_else(|error| panic!("{session} stayed closed: {error}"));
    }
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
            tracing::Span::none(),
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

/// A harness whose runtime registry lists each dial's sessions, as in
/// production, with the reports the service would consume.
fn listing_harness() -> (
    TestHarness,
    InMemoryAgentSessionRepo,
    Arc<RuntimeRegistry<ContainerSender>>,
    mpsc::UnboundedReceiver<crate::outbound::runtime_registry::LiveRuntimeSessions>,
) {
    let repo = InMemoryAgentSessionRepo::new();
    let turn_observer = Arc::new(agent_session::domain::ports::LateBoundTurnObserver::new());
    let (live_sessions, reports) = mpsc::unbounded_channel();
    let runtimes = RuntimeRegistry::reporting_live_sessions(live_sessions);
    let service = AgentHarnessService::new(
        None,
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            turn_observer.clone(),
            Arc::new(RecordingLifecyclePublisher::new()),
            ReplicaId::mint(),
        ),
        MockContainerManager::new(),
        AnnouncerMock::new(),
        TestConnections::new(MirrorBindings::default(), Arc::clone(&runtimes)),
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        NoPeers,
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        HarnessDefaults::new(SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: SessionRepository::parse("https://github.com/macro-inc/macro"),
        }),
        RecordingLifecyclePublisher::new(),
        crate::domain::pending::PendingCommands::new(),
        PromptMentionsMock::new(),
        NotifierMock::new(),
    );
    turn_observer.bind(NoOpTurnObserver);
    (service, repo, runtimes, reports)
}

/// An adapter that lists every session it has ever stored, the way
/// `@agentclientprotocol/claude-agent-acp` 0.73.0 answers `session/list`:
/// Macro's sessions on this harness, archived ones, another harness's, ones
/// Macro never created, and ids that are not Macro's at all. Only the live,
/// unarchived sessions bound to the dialing harness are restored.
#[tokio::test]
async fn a_dial_restores_only_this_harness_tracked_sessions_from_an_agent_that_lists_everything() {
    let (service, repo, runtimes, mut reports) = listing_harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let other_bot = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let tracked = native_session(&service, &repo, bot_id).await;
    let archived = native_session(&service, &repo, bot_id).await;
    agent_session::domain::ports::AgentSessionRepo::set_archived(&repo, archived, true)
        .await
        .unwrap();
    let elsewhere = native_session(&service, &repo, other_bot).await;
    let untracked = AgentSessionId::new();
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), runtime.clone());
    runtime.sends_ready();

    let agent = runtime.agent();
    agent.wait_for_requests(1).await;
    agent.completes_initialize(
        InitializeResponse::new(PROTOCOL_VERSION).agent_capabilities(
            AgentCapabilities::new()
                .load_session(true)
                .session_capabilities(
                    SessionCapabilities::new()
                        .resume(SessionResumeCapabilities::new())
                        .list(agent_client_protocol::schema::v1::SessionListCapabilities::new()),
                ),
        ),
    );
    agent.wait_for_requests(2).await;
    let Some(RawJsonRpcMessage::Request(list)) = agent.received_frames().into_iter().nth(1) else {
        panic!("expected session/list after initialize");
    };
    assert_eq!(list.method.as_ref(), "session/list");
    agent.sends_reply(
        list.id,
        serde_json::json!({"sessions": [
            {"sessionId": tracked.to_string(), "cwd": "/srv/agent", "title": "Fix the build", "updatedAt": "2026-11-02T10:00:00Z"},
            {"sessionId": archived.to_string(), "cwd": "/srv/agent", "title": "Old work", "updatedAt": "2026-10-01T10:00:00Z"},
            {"sessionId": elsewhere.to_string(), "cwd": "/srv/agent", "title": "Other laptop", "updatedAt": "2026-11-01T10:00:00Z"},
            {"sessionId": untracked.to_string(), "cwd": "/home/operator", "title": "Started in a terminal", "updatedAt": "2026-11-02T09:00:00Z"},
            {"sessionId": "claude-local-7f3a", "cwd": "/home/operator/scratch", "title": "Not Macro's", "updatedAt": "2026-10-20T09:00:00Z"},
        ]}),
    );
    let report = reports.recv().await.expect("the dial reports its listing");
    assert_eq!(report.acp_sessions.len(), 5);

    let drive = async {
        agent.wait_for_requests(3).await;
        agent.resumes_session(ResumeSessionResponse::new());
    };
    tokio::join!(
        service.reattach_live_sessions(report.harness, report.acp_sessions, report.span),
        drive
    );

    let requests = agent.received_requests();
    assert_eq!(
        requests.len(),
        3,
        "only one session is restored: {requests:?}"
    );
    assert!(matches!(
        &requests[2],
        ClientRequest::ResumeSessionRequest(request) if request.session_id.to_string() == tracked.to_string()
    ));
    assert!(prompts(&agent).is_empty(), "restoring never prompts");
}

#[tokio::test]
async fn a_redial_delivers_the_prompt_queued_behind_the_turn_the_drop_interrupted() {
    let ((service, repo, _containers, _announcer, runtimes), turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let session = native_session(&service, &repo, bot_id).await;
    let first = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), first.clone());

    let drive = async {
        initializes_loading(&first).await;
        let agent = first.agent();
        agent.wait_for_requests(2).await;
        agent.loads_session(LoadSessionResponse::new());
    };
    let (result, ()) = tokio::join!(prompt(&service, session, "fix the failing test"), drive);
    result.expect("the first prompt binds the session");
    let queued = prompt(&service, session, "and now the docs")
        .await
        .expect("a prompt behind a running turn is accepted");
    assert!(matches!(queued, CommandOutcome::Queued));

    // The connection drops mid-turn: the turn is lost, the queued prompt is
    // not, and nobody prompts the session again.
    let published = turns.lifecycle().len();
    first.disconnects();
    turns.lifecycle_published(published + 1).await;
    assert!(matches!(
        turns.lifecycle().last(),
        Some(AgentSessionLifecycleEvent::Stopped(_))
    ));

    let second = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), second.clone());
    let drive = async {
        initializes_loading(&second).await;
        let agent = second.agent();
        agent.wait_for_requests(2).await;
        agent.loads_session(LoadSessionResponse::new());
    };
    tokio::join!(
        service.reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![SessionId::new(session.to_string())],
            tracing::Span::none(),
        ),
        drive
    );

    assert_eq!(
        prompts(&second.agent()),
        [vec![ContentBlock::from("and now the docs")]]
    );
}
