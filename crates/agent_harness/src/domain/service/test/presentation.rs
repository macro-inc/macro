use super::*;
use agent_session::domain::model::SessionToolPresentation;

#[tokio::test]
async fn presentation_bypasses_the_prompt_queue_and_retries_without_duplicate_frames() {
    let ((service, repo, containers, _, _), _turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let before = prompts(&container.agent()).len();
    let owner = repo.get(id).await.unwrap().owner_user().unwrap().to_owned();
    let presentation = SessionToolPresentation {
        tool_call_id: "review_harness-test".into(),
        title: "mcp__macro_internal__PresentReview".into(),
        raw_input: serde_json::json!({"reviewId":"harness-test","kind":"email","title":"Choice"}),
        raw_output: serde_json::json!({"reviewId":"harness-test","message":"Presented to the user"}),
    };
    for _ in 0..2 {
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            service.present_tool(id, owner.clone(), presentation.clone()),
        )
        .await
        .unwrap()
        .unwrap();
    }
    assert_eq!(prompts(&container.agent()).len(), before);
    assert!(service.queued_controls(id).await.unwrap().is_empty());
    let frames = repo.list_by_session(id).await.unwrap();
    assert_eq!(
        frames
            .iter()
            .filter(|frame| serde_json::to_string(&frame.entry.content)
                .unwrap()
                .contains("review_harness-test"))
            .count(),
        2
    );
}

#[tokio::test(start_paused = true)]
async fn presentation_forward_ack_waits_for_the_remote_durable_pair() {
    use agent_session::domain::ports::AgentSessionLogWriter;
    use agent_session::domain::service::LiveSessionLogWriter;
    let repo = InMemoryAgentSessionRepo::new();
    let session = agent_session::testing::test_agent_session(AgentSessionId::new());
    let id = session.id;
    let owner = session.owner_user().unwrap().to_owned();
    repo.insert_session(session);
    let claim = claim_as_peer(&repo, id).await;
    let forwarder = RecordingForwarder::default();
    let service = AgentHarnessService::new(
        None,
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            Arc::new(NoOpTurnObserver),
            Arc::new(NoopLifecyclePublisher),
            ReplicaId::mint(),
        ),
        MockContainerManager::new(),
        AnnouncerMock::new(),
        TestConnections::new(MirrorBindings, RuntimeRegistry::<ContainerSender>::new()),
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        forwarder.clone(),
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".into(),
            harness: "opencode".into(),
            repo_url: SessionRepository::parse("https://github.com/macro-inc/macro"),
        },
        NoopLifecyclePublisher,
        crate::domain::pending::PendingCommands::new(),
        crate::domain::ports::NoPromptMentions,
        crate::domain::ports::NoopAgentSessionNotifier,
    );
    let presentation = SessionToolPresentation {
        tool_call_id: "review_remote".into(),
        title: "mcp__macro_internal__PresentReview".into(),
        raw_input: serde_json::json!({"reviewId":"remote"}),
        raw_output: serde_json::json!({"message":"Presented to the user"}),
    };
    let expected = presentation.clone();
    let pending = tokio::spawn(async move { service.present_tool(id, owner, presentation).await });
    while forwarder.calls.lock().unwrap().is_empty() {
        tokio::task::yield_now().await;
    }
    assert!(
        !pending.is_finished(),
        "bus publication cannot acknowledge durable presentation"
    );
    let mut remote = LiveSessionLogWriter::fenced(repo.clone(), NoOpRealtime, claim);
    remote
        .present_tool(id, SessionId::new("peer-acp"), expected)
        .await
        .unwrap();
    pending.await.unwrap().unwrap();
    assert_eq!(repo.list_by_session(id).await.unwrap().len(), 2);
}
