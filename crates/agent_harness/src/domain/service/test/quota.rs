use super::*;
use ai_billing::domain::{AiAdmissionError, AiAdmissionService, DenyReason};
use ai_usage::domain::AiFeature;
use std::pin::Pin;

#[derive(Clone, Copy, Default)]
enum Decision {
    #[default]
    Allow,
    Deny,
    Unavailable,
}

#[derive(Default)]
pub(super) struct TestAdmission {
    decision: Mutex<Decision>,
    sequence: Mutex<std::collections::VecDeque<Decision>>,
    calls: Mutex<Vec<(String, AiFeature)>>,
}

impl AiAdmissionService for TestAdmission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>> {
        self.calls.lock().unwrap().push((user.to_string(), feature));
        let decision = self
            .sequence
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(*self.decision.lock().unwrap());
        Box::pin(async move {
            match decision {
                Decision::Allow => Ok(()),
                Decision::Deny => Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted)),
                Decision::Unavailable => Err(AiAdmissionError::Unavailable(rootcause::report!(
                    "private storage failure"
                ))),
            }
        })
    }
}

fn bench(decision: Decision) -> (TestBench, TurnSignals, Arc<TestAdmission>) {
    let gate = Arc::new(TestAdmission::default());
    *gate.decision.lock().unwrap() = decision;
    let (bench, signals) = harness_with_admission(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        PromptMentionsMock::new(),
        gate.clone(),
    );
    (bench, signals, gate)
}

async fn session_with_a_running_turn(
    service: &TestHarness,
    containers: &MockContainerManager,
    id: AgentSessionId,
) -> ContainerMock {
    let mut open = open_command();
    open.bot_id = bot_id::MACRO_NEW_BOT_ID;
    open.runtime.kind = AgentKind::InMemory;
    open.runtime.harness = "macro-inmem".to_owned();
    let drive = async {
        while containers.spawned() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(id).unwrap();
        complete_session_handshake(&container).await;
        container.agent().wait_for_requests(3).await;
        container
    };
    let (result, container) = tokio::join!(service.execute(id, HarnessCommand::Open(open)), drive);
    result.unwrap();
    container
}

fn command(action: AgentAction) -> HarnessCommand {
    HarnessCommand::Deliver(DeliverAction::prompt(action, Some(staff_sender()), None))
}

#[test]
fn admission_errors_keep_the_session_error_classification() {
    for reason in [
        DenyReason::AllowanceExhausted,
        DenyReason::OverageLimitReached,
        DenyReason::OveragePaymentFailed,
    ] {
        assert!(
            matches!(into_session_error(HarnessError::Admission(AiAdmissionError::Denied(reason))),
            AgentSessionError::Admission(AiAdmissionError::Denied(actual)) if actual == reason)
        );
    }
    assert!(matches!(
        into_session_error(HarnessError::Admission(AiAdmissionError::Unavailable(
            rootcause::report!("internal")
        ))),
        AgentSessionError::Admission(AiAdmissionError::Unavailable(_))
    ));
}

fn assert_denied(error: HarnessError) {
    assert!(matches!(
        error,
        HarnessError::Admission(AiAdmissionError::Denied(DenyReason::AllowanceExhausted))
    ));
}

#[tokio::test]
async fn denied_new_sessions_create_and_provision_nothing() {
    for kind in [AgentKind::InMemory, AgentKind::SandboxedCoder] {
        let ((service, repo, containers, announcer, _), _, gate) = bench(Decision::Deny);
        let id = AgentSessionId::new();
        let mut open = open_command();
        open.runtime.kind = kind;
        assert_denied(
            service
                .execute(id, HarnessCommand::Open(open))
                .await
                .unwrap_err(),
        );
        assert!(repo.get(id).await.is_err());
        assert_eq!(containers.spawned(), 0);
        assert!(announcer.announced().is_empty());
        assert!(service.inner.egress.provisioned().is_empty());
        assert_eq!(
            *gate.calls.lock().unwrap(),
            [(sender().to_string(), AiFeature::AgentSession)]
        );
    }
}

#[tokio::test]
async fn managed_create_preserves_typed_admission_and_does_not_provision() {
    let ((service, _, containers, _, _), _, _) = bench(Decision::Deny);
    let error = service
        .open_managed_session(OpenManagedSession {
            id: None,
            repo_url: None,
            repo_branch: None,
            instructions: None,
            model: None,
            owner: model_owner::Owner::User(sender()),
            prompt: Some("hello".to_owned()),
            profile: Some(agent_session::domain::ports::SelectedManagedPersona {
                bot_id: bot_id::MACRO_NEW_BOT_ID,
                profile: None,
            }),
        })
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        AgentSessionError::Admission(AiAdmissionError::Denied(_))
    ));
    assert_eq!(containers.spawned(), 0);
    assert!(service.inner.egress.provisioned().is_empty());
}

#[tokio::test]
async fn exhausted_owner_blocks_collaborator_prompts_compact_and_resume() {
    for action in [AgentAction::prompt("hello"), AgentAction::Compact] {
        let ((service, repo, containers, _, _), _, gate) = bench(Decision::Deny);
        let id = disconnected_session(&repo, &containers).await;
        assert_denied(service.execute(id, command(action)).await.unwrap_err());
        assert_eq!(containers.resumed(), 0);
        assert!(!service.inner.busy.is_pending(id));
        assert!(service.queued_controls(id).await.unwrap().is_empty());
        assert_eq!(
            *gate.calls.lock().unwrap(),
            [(sender().to_string(), AiFeature::AgentSession)]
        );
    }
}

#[tokio::test]
async fn immediate_dispatch_rechecks_before_resume_or_announcement() {
    let ((service, repo, containers, announcer, _), _, gate) = bench(Decision::Allow);
    let id = disconnected_session(&repo, &containers).await;
    gate.sequence
        .lock()
        .unwrap()
        .extend([Decision::Allow, Decision::Deny]);
    assert_denied(
        service
            .execute(id, HarnessCommand::Deliver(forward_message("race")))
            .await
            .unwrap_err(),
    );
    assert_eq!(gate.calls.lock().unwrap().len(), 2);
    assert_eq!(containers.resumed(), 0);
    assert!(announcer.announced().is_empty());
    assert!(service.queued_controls(id).await.unwrap().is_empty());
    assert!(!service.inner.busy.is_pending(id));
}

#[tokio::test]
async fn access_failure_precedes_billing() {
    let ((service, repo, containers, _, _), _, gate) = bench(Decision::Deny);
    let id = disconnected_session(&repo, &containers).await;
    let error = prompt(&service, id, "not staff").await.unwrap_err();
    assert!(matches!(
        error,
        HarnessError::Session(AgentSessionError::Forbidden)
    ));
    assert!(gate.calls.lock().unwrap().is_empty());
}

fn forwarding_harness(
    repo: InMemoryAgentSessionRepo,
    gate: Arc<TestAdmission>,
    forwarder: RecordingForwarder,
) -> TestHarness {
    AgentHarnessService::new(
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            Arc::new(NoOpTurnObserver),
            Arc::new(NoopLifecyclePublisher),
            ReplicaId::mint(),
        ),
        MockContainerManager::new(),
        AnnouncerMock::new(),
        TestConnections::new(MirrorBindings, RuntimeRegistry::new()),
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        forwarder,
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: None,
        },
        RecordingLifecyclePublisher::new(),
        crate::domain::pending::PendingCommands::new(),
        PromptMentionsMock::new(),
        NotifierMock::new(),
        gate,
    )
}

#[tokio::test]
async fn peer_admission_is_synchronous_and_running_retries_remain_idempotent() {
    let ((manager, repo, containers, _, _), _, gate) = bench(Decision::Allow);
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&manager, &containers, id).await;
    // The serving replica's lease must be live for ingress to choose forwarding.
    use agent_session::domain::ports::SessionOwnership;
    repo.heartbeat(manager.inner.sessions.replica_id(), None)
        .await
        .unwrap();
    let forwarder = RecordingForwarder::default();
    let ingress = forwarding_harness(repo, gate.clone(), forwarder.clone());
    ingress
        .execute(id, command(AgentAction::prompt("allowed")))
        .await
        .unwrap();
    assert_eq!(forwarder.calls.lock().unwrap().len(), 1);

    for decision in [Decision::Deny, Decision::Unavailable] {
        *gate.decision.lock().unwrap() = decision;
        let error = ingress
            .execute(id, command(AgentAction::Compact))
            .await
            .unwrap_err();
        assert!(matches!(error, HarnessError::Admission(_)));
        assert_eq!(forwarder.calls.lock().unwrap().len(), 1);
        assert_eq!(
            ingress
                .execute(
                    id,
                    HarnessCommand::Deliver(DeliverAction {
                        id: manager.inner.busy.turn(id).unwrap().action_id,
                        action: AgentAction::prompt("retry"),
                        actor: Some(sender()),
                        announce: None,
                    })
                )
                .await
                .unwrap(),
            CommandOutcome::Completed
        );
        assert_eq!(forwarder.calls.lock().unwrap().len(), 1);
        assert_eq!(prompts(&container.agent()).len(), 1);
    }
}

#[tokio::test]
async fn received_forwards_are_checked_before_execution() {
    let ((service, repo, containers, _, _), turns, _) = bench(Decision::Deny);
    let id = disconnected_session(&repo, &containers).await;
    let HarnessCommand::Deliver(deliver) = command(AgentAction::prompt("forwarded")) else {
        unreachable!()
    };
    let action_id = deliver.id;
    assert_denied(
        service
            .execute_here(id, HarnessCommand::Deliver(deliver))
            .await
            .unwrap_err(),
    );
    assert_eq!(containers.resumed(), 0);
    assert!(matches!(turns.lifecycle().as_slice(),
        [AgentSessionLifecycleEvent::CommandRejected(rejected)]
        if rejected.action_id == action_id && rejected.code == DenyReason::AllowanceExhausted.code()));
}

#[tokio::test]
async fn queued_exhaustion_is_terminal_observable_and_does_not_start_work() {
    let ((service, _, containers, announcer, _), mut turns, gate) = bench(Decision::Allow);
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let mut ids = Vec::new();
    for action in [AgentAction::prompt("later"), AgentAction::Compact] {
        let HarnessCommand::Deliver(deliver) = command(action) else {
            unreachable!()
        };
        ids.push(deliver.id);
        assert_eq!(
            service
                .execute(id, HarnessCommand::Deliver(deliver))
                .await
                .unwrap(),
            CommandOutcome::Queued
        );
    }
    let announcements = announcer.announced().len();
    let running_id = service.inner.busy.turn(id).unwrap().action_id;
    *gate.decision.lock().unwrap() = Decision::Deny;
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    // A barrier on the same worker ensures dispatch has finished.
    service
        .execute(
            id,
            HarnessCommand::RemoveQueued {
                action_id: AgentActionId::mint(),
                actor: Some(sender()),
            },
        )
        .await
        .unwrap_err();
    assert!(service.queued_controls(id).await.unwrap().is_empty());
    assert!(!service.inner.busy.is_pending(id));
    assert_eq!(prompts(&container.agent()).len(), 1);
    assert_eq!(announcer.announced().len(), announcements);
    assert!(matches!(
        turns.lifecycle().last(),
        Some(AgentSessionLifecycleEvent::Settled(settled))
            if settled.last_turn.as_ref().unwrap().action_id == running_id
    ));
    let rejected: Vec<_> = turns
        .lifecycle()
        .into_iter()
        .filter_map(|event| {
            if let AgentSessionLifecycleEvent::CommandRejected(rejected) = event {
                Some(rejected)
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        rejected
            .iter()
            .map(|event| event.action_id)
            .collect::<Vec<_>>(),
        ids
    );
    assert!(
        rejected
            .iter()
            .all(|event| event.code == DenyReason::AllowanceExhausted.code()
                && event.error == DenyReason::AllowanceExhausted.message())
    );

    *gate.decision.lock().unwrap() = Decision::Allow;
    prompt(&service, id, "new request after purchase")
        .await
        .unwrap();
    assert_eq!(prompts(&container.agent()).len(), 2);
}

#[tokio::test]
async fn queued_exhaustion_resolves_every_already_announced_reply() {
    let ((service, _, containers, announcer, _), mut turns, gate) = bench(Decision::Allow);
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    for text in ["first follow-up", "second follow-up"] {
        assert_eq!(
            service
                .execute(id, HarnessCommand::Deliver(forward_message(text)))
                .await
                .unwrap(),
            CommandOutcome::Queued
        );
    }
    let messages = announcer.announced_messages();
    assert_eq!(messages.len(), 3);
    assert!(announcer.resolved().is_empty());

    *gate.decision.lock().unwrap() = Decision::Deny;
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    // Serialize behind the turn-end command, including all reply resolutions.
    service
        .execute(
            id,
            HarnessCommand::RemoveQueued {
                action_id: AgentActionId::mint(),
                actor: Some(sender()),
            },
        )
        .await
        .unwrap_err();

    let resolved = announcer.resolved();
    assert_eq!(resolved.len(), 3);
    for message in &messages[1..] {
        let reply = resolved
            .iter()
            .find(|reply| reply.message_id == message.message_id)
            .unwrap();
        assert_eq!(reply.outcome, crate::domain::model::ReplyOutcome::Failed);
        assert_eq!(reply.triggered_by, staff_sender());
        assert_eq!(reply.session_id, id);
    }
    assert!(service.queued_controls(id).await.unwrap().is_empty());
    assert!(!service.inner.busy.is_pending(id));
    assert_eq!(prompts(&container.agent()).len(), 1);
    assert!(matches!(
        turns.lifecycle().last(),
        Some(AgentSessionLifecycleEvent::Settled(_))
    ));
}

#[tokio::test]
async fn running_and_queued_retries_do_not_spend_or_fail_after_exhaustion() {
    let ((service, _, containers, _, _), _, gate) = bench(Decision::Allow);
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let running_id = service.inner.busy.turn(id).unwrap().action_id;
    let queued = command(AgentAction::prompt("later"));
    service.execute(id, queued.clone()).await.unwrap();
    *gate.decision.lock().unwrap() = Decision::Deny;
    let calls = gate.calls.lock().unwrap().len();
    assert_eq!(
        service.execute(id, queued).await.unwrap(),
        CommandOutcome::Queued
    );
    assert_eq!(
        service
            .execute(
                id,
                HarnessCommand::Deliver(DeliverAction {
                    id: running_id,
                    action: AgentAction::prompt("retry"),
                    actor: Some(sender()),
                    announce: None,
                })
            )
            .await
            .unwrap(),
        CommandOutcome::Completed
    );
    assert_eq!(gate.calls.lock().unwrap().len(), calls);
    assert_eq!(prompts(&container.agent()).len(), 1);
}

#[tokio::test]
async fn unavailable_billing_does_not_start_or_spin_queued_work() {
    let ((service, _, containers, _, _), mut turns, gate) = bench(Decision::Allow);
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    service
        .execute(id, command(AgentAction::Compact))
        .await
        .unwrap();
    *gate.decision.lock().unwrap() = Decision::Unavailable;
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    service
        .execute(
            id,
            HarnessCommand::RemoveQueued {
                action_id: AgentActionId::mint(),
                actor: Some(sender()),
            },
        )
        .await
        .unwrap_err();
    assert!(!service.inner.busy.is_pending(id));
    assert_eq!(service.queued_controls(id).await.unwrap().len(), 1);
    assert!(!turns.lifecycle().iter().any(|event| matches!(
        event,
        AgentSessionLifecycleEvent::Settled(_) | AgentSessionLifecycleEvent::CommandRejected(_)
    )));
    assert_eq!(prompts(&container.agent()).len(), 1);
    let calls = gate.calls.lock().unwrap().len();
    tokio::task::yield_now().await;
    assert_eq!(gate.calls.lock().unwrap().len(), calls);
    let error = prompt(&service, id, "new work").await.unwrap_err();
    assert!(matches!(
        error,
        HarnessError::Admission(AiAdmissionError::Unavailable(_))
    ));
    assert!(!error.to_string().contains("private"));
}

#[tokio::test]
async fn stop_permission_queue_removal_and_delete_remain_available() {
    let ((service, _, containers, _, _), _, gate) = bench(Decision::Allow);
    let id = AgentSessionId::new();
    let container = session_with_a_running_turn(&service, &containers, id).await;
    let queued = service
        .control_event(
            id,
            ControlEvent {
                action_id: None,
                action: AgentAction::Compact,
                actor: Some(sender()),
            },
        )
        .await
        .unwrap();
    *gate.decision.lock().unwrap() = Decision::Deny;
    let calls = gate.calls.lock().unwrap().len();
    service
        .remove_queued_control(id, queued.action_id, Some(sender()))
        .await
        .unwrap();
    service
        .execute(id, command(AgentAction::Stop))
        .await
        .unwrap();
    let _ = service
        .execute(id, command(permission_answer("missing", "once")))
        .await;
    service.execute(id, HarnessCommand::Delete).await.unwrap();
    assert_eq!(gate.calls.lock().unwrap().len(), calls);
    assert_eq!(prompts(&container.agent()).len(), 1);
}

#[tokio::test]
async fn externally_funded_execution_never_checks_the_gate() {
    let ((service, repo, _, _, _), _, gate) = bench(Decision::Deny);
    for harness in ["cursor", "codex-cloud", "claude-cloud", "macrod"] {
        let mut session = agent_session::testing::test_agent_session(AgentSessionId::new());
        session.bot_id = BotId::TEST_A;
        session.harness = harness.to_owned();
        let id = session.id;
        repo.insert_session(session);
        service.inner.admit_session(id).await.unwrap();
    }
    assert!(gate.calls.lock().unwrap().is_empty());
}
