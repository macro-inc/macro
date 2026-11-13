//! A runtime that dials in again reports the sessions its agents still serve,
//! and the harness loads them without anyone prompting.

use super::*;
use agent_client_protocol::schema::v1::LoadSessionResponse;
use agent_session::domain::connection::ListedSession;

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
            vec![ListedSession {
                id: SessionId::new(session.to_string()),
                updated_at: None,
            }],
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
            vec![ListedSession {
                id: SessionId::new(session.to_string()),
                updated_at: None,
            }],
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
                ListedSession {
                    id: SessionId::new(first.to_string()),
                    updated_at: None,
                },
                ListedSession {
                    id: SessionId::new(second.to_string()),
                    updated_at: None,
                },
                ListedSession {
                    id: SessionId::new(archived.to_string()),
                    updated_at: None,
                },
                ListedSession {
                    id: SessionId::new(AgentSessionId::new().to_string()),
                    updated_at: None,
                },
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
async fn a_live_session_on_a_runtime_that_is_gone_is_left_for_the_next_dial() {
    let (service, repo, _containers, _announcer, _runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let session = native_session(&service, &repo, bot_id).await;

    // The report raced the connection's end: nothing is attached and the
    // session stays reattachable when the runtime dials again.
    let report = service
        .reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![ListedSession {
                id: SessionId::new(session.to_string()),
                updated_at: None,
            }],
            tracing::Span::none(),
        )
        .await;
    assert_eq!(
        report.abandoned, 1,
        "a dial gives up once its runtime is gone"
    );
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
        service.reattach_live_sessions(report.harness, report.acp_sessions, report.span,),
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

    // Untouched for days, but its queue still holds work: a dial restores it.
    repo.set_modified_at(session, chrono::Utc::now() - chrono::Duration::days(2));
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
            vec![ListedSession {
                id: SessionId::new(session.to_string()),
                updated_at: None,
            }],
            tracing::Span::none(),
        ),
        drive
    );

    assert_eq!(
        prompts(&second.agent()),
        [vec![ContentBlock::from("and now the docs")]]
    );
}

#[tokio::test]
async fn a_redial_restores_recent_sessions_and_leaves_idle_ones_to_their_next_prompt() {
    let (service, repo, _containers, _announcer, runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let recent = native_session(&service, &repo, bot_id).await;
    let idle = native_session(&service, &repo, bot_id).await;
    repo.set_modified_at(idle, chrono::Utc::now() - chrono::Duration::days(9));
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), runtime.clone());

    let drive = async {
        initializes_loading(&runtime).await;
        let agent = runtime.agent();
        agent.wait_for_requests(2).await;
        agent.loads_session(LoadSessionResponse::new());
    };
    let (report, ()) = tokio::join!(
        service.reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![
                ListedSession {
                    id: SessionId::new(recent.to_string()),
                    updated_at: None,
                },
                ListedSession {
                    id: SessionId::new(idle.to_string()),
                    updated_at: None,
                },
            ],
            tracing::Span::none(),
        ),
        drive
    );
    assert_eq!((report.eager, report.lazy), (1, 1), "{report:?}");

    let agent = runtime.agent();
    assert_eq!(loaded(&agent), [recent.to_string()]);
    assert!(
        agent_session::domain::service::AgentSessionService::attached_mcp_servers(
            &service.inner.sessions,
            idle
        )
        .is_none(),
        "an idle session is not restored at dial time"
    );

    // The idle session's next prompt restores it on the same connection.
    let drive = async {
        agent.wait_for_requests(3).await;
        agent.loads_session(LoadSessionResponse::new());
        agent.wait_for_requests(4).await;
    };
    let (result, ()) = tokio::join!(prompt(&service, idle, "pick this back up"), drive);
    result.expect("the prompt restores the idle session");
    assert_eq!(loaded(&agent), [recent.to_string(), idle.to_string()]);
    assert_eq!(
        prompts(&agent),
        [vec![ContentBlock::from("pick this back up")]]
    );
}

#[tokio::test]
async fn a_redial_restores_only_a_few_sessions_at_a_time() {
    let (service, repo, _containers, _announcer, runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let limit = super::super::reattach::REATTACH_CONCURRENCY;
    let total = limit + 4;
    let mut sessions = Vec::new();
    for _ in 0..total {
        sessions.push(native_session(&service, &repo, bot_id).await);
    }
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), runtime.clone());

    let drive = async {
        initializes_loading(&runtime).await;
        let agent = runtime.agent();
        agent.wait_for_requests(1 + limit).await;
        assert_eq!(
            agent.received_requests().len(),
            1 + limit,
            "the next restore waits for a permit"
        );
        let mut answered = Vec::new();
        while answered.len() < total {
            agent.wait_for_requests(1 + answered.len() + 1).await;
            for frame in agent.received_frames() {
                if let RawJsonRpcMessage::Request(request) = frame
                    && request.method.as_ref() == "session/load"
                    && !answered.contains(&request.id)
                {
                    answered.push(request.id.clone());
                    agent.sends_reply(request.id, LoadSessionResponse::new());
                }
            }
            assert!(agent.received_requests().len() <= 1 + answered.len() + limit);
        }
    };
    let (report, ()) = tokio::join!(
        service.reattach_live_sessions(
            harness_for_bot(bot_id),
            sessions
                .iter()
                .map(|session| ListedSession {
                    id: SessionId::new(session.to_string()),
                    updated_at: None,
                })
                .collect(),
            tracing::Span::none(),
        ),
        drive
    );

    assert_eq!(report.eager, total);
    let mut loaded = loaded(&runtime.agent());
    loaded.sort();
    let mut expected: Vec<String> = sessions.iter().map(ToString::to_string).collect();
    expected.sort();
    assert_eq!(loaded, expected);
}

#[tokio::test]
async fn a_redial_cancels_the_harness_previous_dial() {
    let (service, repo, _containers, _announcer, runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let limit = super::super::reattach::REATTACH_CONCURRENCY;
    let total = limit + 1;
    let mut sessions = Vec::new();
    for _ in 0..total {
        sessions.push(native_session(&service, &repo, bot_id).await);
    }
    let listed: Vec<ListedSession> = sessions
        .iter()
        .map(|session| ListedSession {
            id: SessionId::new(session.to_string()),
            updated_at: None,
        })
        .collect();
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), runtime.clone());

    let first = tokio::spawn({
        let service = service.clone();
        let listed = listed.clone();
        async move {
            service
                .reattach_live_sessions(harness_for_bot(bot_id), listed, tracing::Span::none())
                .await
        }
    });
    initializes_loading(&runtime).await;
    let agent = runtime.agent();
    agent.wait_for_requests(1 + limit).await;

    // The runtime dials again before any restore finished. Joined with the
    // answers so the new dial has taken over before any restore completes.
    let answer_loads = async {
        let mut answered = Vec::new();
        while answered.len() < total {
            agent.wait_for_requests(1 + answered.len() + 1).await;
            for frame in agent.received_frames() {
                if let RawJsonRpcMessage::Request(request) = frame
                    && request.method.as_ref() == "session/load"
                    && !answered.contains(&request.id)
                {
                    answered.push(request.id.clone());
                    agent.sends_reply(request.id, LoadSessionResponse::new());
                }
            }
        }
    };
    let (second, ()) = tokio::join!(
        service.reattach_live_sessions(harness_for_bot(bot_id), listed, tracing::Span::none()),
        answer_loads
    );
    let first = first.await.expect("the first dial's task");

    // The restores the first dial had running finish under their permits;
    // it starts nothing more.
    assert_eq!(
        (first.eager, first.abandoned),
        (limit, 1),
        "the first dial stops starting restores: {first:?}"
    );
    assert_eq!(
        second.eager, total,
        "the second dial restores all: {second:?}"
    );
    let mut loaded = loaded(&agent);
    loaded.sort();
    let mut expected: Vec<String> = sessions.iter().map(ToString::to_string).collect();
    expected.sort();
    assert_eq!(loaded, expected, "each session is loaded once");
}

#[tokio::test(start_paused = true)]
async fn a_redial_retries_a_session_whose_restore_failed() {
    let (service, repo, _containers, _announcer, runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let session = native_session(&service, &repo, bot_id).await;
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), runtime.clone());

    let drive = async {
        initializes_loading(&runtime).await;
        let agent = runtime.agent();
        agent.wait_for_requests(2).await;
        let Some(RawJsonRpcMessage::Request(load)) = agent.received_frames().into_iter().nth(1)
        else {
            panic!("expected session/load after initialize");
        };
        agent.sends_error(load.id, agent_client_protocol::Error::internal_error());
        agent.wait_for_requests(3).await;
        agent.loads_session(LoadSessionResponse::new());
    };
    let (report, ()) = tokio::join!(
        service.reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![ListedSession {
                id: SessionId::new(session.to_string()),
                updated_at: None,
            }],
            tracing::Span::none(),
        ),
        drive
    );

    assert_eq!(report.eager, 1, "{report:?}");
    assert_eq!(report.retries, 1);
    assert_eq!(
        loaded(&runtime.agent()),
        [session.to_string(), session.to_string()]
    );
}

#[tokio::test]
async fn a_redial_does_not_retry_a_session_its_runtime_no_longer_serves() {
    let (service, repo, _containers, _announcer, runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let other_bot = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    // The session's bot is bound to a harness that is not connected; the
    // dialing runtime serves another bot.
    let session = native_session(&service, &repo, bot_id).await;
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(other_bot), runtime);

    let report = service
        .reattach_live_sessions(
            harness_for_bot(other_bot),
            vec![ListedSession {
                id: SessionId::new(session.to_string()),
                updated_at: None,
            }],
            tracing::Span::none(),
        )
        .await;

    assert_eq!(report.failed, 1, "{report:?}");
    assert_eq!(report.retries, 0, "retrying cannot help");
}

#[tokio::test]
async fn a_redial_dispatches_the_queue_an_earlier_attach_failed_to_load() {
    let (service, repo, _containers, _announcer, runtimes) = harness();
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
            vec![ListedSession {
                id: SessionId::new(session.to_string()),
                updated_at: None,
            }],
            tracing::Span::none(),
        ),
        drive
    );

    // As if that attach had succeeded and loading its durable queue had not.
    service.inner.hydrated.remove(&session);
    let waiting = crate::domain::queue::QueuedEntry {
        action_id: AgentActionId::mint(),
        action: AgentAction::prompt("and now the docs"),
        actor: Some(sender()),
        announce: None,
        context: None,
        announced: None,
        client: None,
        created_at: chrono::Utc::now(),
    };
    repo.replace_queued_actions(session, &[waiting.to_stored().unwrap()])
        .await
        .unwrap();

    let drive = async { runtime.agent().wait_for_requests(3).await };
    let (report, ()) = tokio::join!(
        service.reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![ListedSession {
                id: SessionId::new(session.to_string()),
                updated_at: None,
            }],
            tracing::Span::none(),
        ),
        drive
    );

    assert_eq!(report.eager, 1, "{report:?}");
    assert_eq!(
        prompts(&runtime.agent()),
        [vec![ContentBlock::from("and now the docs")]]
    );
}

#[tokio::test]
async fn a_redial_restores_a_session_whose_turn_the_drop_interrupted_however_old() {
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
        agent.wait_for_requests(3).await;
    };
    let (result, ()) = tokio::join!(prompt(&service, session, "refactor the parser"), drive);
    result.expect("the prompt starts a turn");

    // The socket drops mid-turn, for real: the session records its
    // disconnect, and nobody here remembers the turn.
    let published = turns.lifecycle().len();
    first.disconnects();
    turns.lifecycle_published(published + 1).await;
    assert!(!service.inner.busy.is_pending(session));
    // The turn started long before the drop.
    repo.set_modified_at(session, chrono::Utc::now() - chrono::Duration::hours(3));

    let second = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), second.clone());
    let drive = async {
        initializes_loading(&second).await;
        let agent = second.agent();
        agent.wait_for_requests(2).await;
        agent.loads_session(LoadSessionResponse::new());
    };
    let (report, ()) = tokio::join!(
        service.reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![ListedSession {
                id: SessionId::new(session.to_string()),
                updated_at: None,
            }],
            tracing::Span::none(),
        ),
        drive
    );

    assert_eq!(report.eager, 1, "{report:?}");
    assert_eq!(loaded(&second.agent()), [session.to_string()]);
}

#[tokio::test]
async fn a_redial_restores_a_session_its_runtime_saw_active_recently() {
    let (service, repo, _containers, _announcer, runtimes) = harness();
    let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let worked_locally = native_session(&service, &repo, bot_id).await;
    let untouched = native_session(&service, &repo, bot_id).await;
    // Neither was prompted from Macro for days; the runtime says someone
    // worked in one of them minutes ago, in its terminal.
    let days_ago = chrono::Utc::now() - chrono::Duration::days(3);
    repo.set_modified_at(worked_locally, days_ago);
    repo.set_modified_at(untouched, days_ago);
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(bot_id), runtime.clone());

    let drive = async {
        initializes_loading(&runtime).await;
        let agent = runtime.agent();
        agent.wait_for_requests(2).await;
        agent.loads_session(LoadSessionResponse::new());
    };
    let (report, ()) = tokio::join!(
        service.reattach_live_sessions(
            harness_for_bot(bot_id),
            vec![
                ListedSession {
                    id: SessionId::new(worked_locally.to_string()),
                    updated_at: Some(chrono::Utc::now() - chrono::Duration::minutes(5)),
                },
                ListedSession {
                    id: SessionId::new(untouched.to_string()),
                    updated_at: Some(days_ago),
                },
            ],
            tracing::Span::none(),
        ),
        drive
    );

    assert_eq!((report.eager, report.lazy), (1, 1), "{report:?}");
    assert_eq!(loaded(&runtime.agent()), [worked_locally.to_string()]);
}

#[tokio::test]
async fn a_dormant_listed_session_costs_the_dial_nothing() {
    // The dormant session exists nowhere and no runtime is connected: any
    // per-session lookup would fail it or abandon it instead of counting it.
    let dormant = AgentSessionId::new();
    let service = harness_sharing_repo_with_bindings(
        InMemoryAgentSessionRepo::new(),
        MirrorBindings {
            dormant: vec![dormant],
            ..MirrorBindings::default()
        },
    );

    let report = service
        .reattach_live_sessions(
            harness_id::HarnessId::new_from_uuid(macro_uuid::generate_uuid_v7()),
            vec![ListedSession {
                id: SessionId::new(dormant.to_string()),
                updated_at: None,
            }],
            tracing::Span::none(),
        )
        .await;

    assert_eq!(
        report,
        super::super::reattach::ReattachReport {
            dormant: 1,
            ..Default::default()
        }
    );
}
