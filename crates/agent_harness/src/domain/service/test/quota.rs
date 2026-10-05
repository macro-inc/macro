use super::*;
use ai_billing::{AdmissionFuture, AiAdmissionError, AiAdmissionService, DenyReason};
use ai_usage::AiFeature;
use model_owner::Owner;

#[derive(Default)]
struct AdmissionMock {
    failure: Mutex<Option<AiAdmissionError>>,
    responses: Mutex<std::collections::VecDeque<Option<AiAdmissionError>>>,
    calls: Mutex<Vec<(String, AiFeature)>>,
}

impl AiAdmissionService for AdmissionMock {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        self.calls.lock().unwrap().push((user.to_string(), feature));
        let failure = self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(*self.failure.lock().unwrap());
        Box::pin(async move { failure.map_or(Ok(()), Err) })
    }
}

fn denied() -> AiAdmissionError {
    AiAdmissionError::Denied(DenyReason::AllowanceExhausted)
}

fn bench(
    failure: Option<AiAdmissionError>,
) -> (TestHarness, InMemoryAgentSessionRepo, Arc<AdmissionMock>) {
    let repo = InMemoryAgentSessionRepo::new();
    let admission = Arc::new(AdmissionMock {
        failure: Mutex::new(failure),
        ..Default::default()
    });
    let service = harness_sharing_repo(repo.clone()).with_admission(admission.clone());
    (service, repo, admission)
}

async fn session(
    repo: &InMemoryAgentSessionRepo,
    bot: BotId,
    harness: &str,
    owner: Owner,
) -> AgentSessionId {
    let id = AgentSessionId::new();
    agent_session::domain::ports::AgentSessionRepo::create(
        repo,
        CreateAgentSessionParams {
            id,
            owner_id: owner,
            bot_id: bot,
            thread_id: None,
            originating_message_id: None,
            model: "model".into(),
            harness: harness.into(),
            repo_url: None,
            repo_branch: None,
            workspace: "/workspace".into(),
            sandbox_size: SandboxSize::Default,
            instructions: None,
            mcp_servers: AgentMcpServers::OwnerConnections,
            egress_token_hash: None,
        },
    )
    .await
    .unwrap();
    id
}

fn action(action: AgentAction) -> DeliverAction {
    DeliverAction {
        id: AgentActionId::mint(),
        action,
        actor: Some(staff_sender()),
        announce: None,
    }
}

fn assert_no_provisioning(service: &TestHarness) {
    assert_eq!(service.inner.containers.spawned(), 0);
    assert_eq!(service.inner.containers.resumed(), 0);
    assert!(service.inner.egress.provisioned().is_empty());
    assert!(service.inner.announcer.announced().is_empty());
    assert!(
        service
            .inner
            .lifecycle_publisher
            .published()
            .iter()
            .all(|event| { matches!(event, AgentSessionLifecycleEvent::CommandRejected(_)) })
    );
}

#[tokio::test]
async fn denied_or_unavailable_trigger_open_has_no_side_effects() {
    for failure in [denied(), AiAdmissionError::Unavailable] {
        for (bot, kind, harness) in [
            (
                bot_id::MACRO_CODER_BOT_ID,
                AgentKind::SandboxedCoder,
                "opencode",
            ),
            (BotId::TEST_A, AgentKind::InMemory, "in-memory"),
        ] {
            let (service, repo, admission) = bench(Some(failure));
            let mut open = open_command();
            open.bot_id = bot;
            open.runtime.kind = kind;
            open.runtime.harness = harness.into();
            mention_origin_mut(&mut open).sender = staff_sender();
            for origin in [
                open.origin.clone(),
                SessionOrigin::TaskAssignment(crate::domain::model::TaskAssignmentOrigin {
                    parent: MessageParent::parse("document", "assigned-task").unwrap(),
                    discussion_id: macro_uuid::generate_uuid_v7(),
                    actor: staff_sender(),
                    prompt: "Work on this task".to_owned(),
                }),
            ] {
                admission.calls.lock().unwrap().clear();
                open.origin = origin;
                let id = AgentSessionId::new();
                let result = service
                    .execute_here(id, HarnessCommand::Open(open.clone()))
                    .await;
                assert!(matches!(result, Err(HarnessError::Admission(error)) if error == failure));
                assert!(repo.get(id).await.is_err());
                assert_eq!(
                    *admission.calls.lock().unwrap(),
                    [(staff_sender().to_string(), AiFeature::AgentSession)]
                );
                assert_no_provisioning(&service);
            }
        }
    }
}

#[tokio::test]
async fn unauthorized_open_never_consults_billing() {
    let (service, _, admission) = bench(Some(denied()));
    let mut open = open_command();
    open.bot_id = bot_id::MACRO_CODER_BOT_ID;
    assert!(matches!(
        service
            .execute_here(AgentSessionId::new(), HarnessCommand::Open(open.clone()))
            .await,
        Err(HarnessError::Session(AgentSessionError::Forbidden))
    ));
    mention_origin_mut(&mut open).sender = staff_sender();
    *service.inner.prompt_context.unauthorized.lock().unwrap() = Some("no access".into());
    assert!(matches!(
        service
            .execute_here(AgentSessionId::new(), HarnessCommand::Open(open))
            .await,
        Err(HarnessError::PromptContext(_))
    ));
    assert!(admission.calls.lock().unwrap().is_empty());
    assert_no_provisioning(&service);
}

#[tokio::test]
async fn managed_open_checks_quota_before_provisioning_without_an_initial_prompt() {
    use agent_session::domain::ports::SelectedManagedPersona;
    for failure in [denied(), AiAdmissionError::Unavailable] {
        let (service, repo, _) = bench(Some(failure));
        let id = AgentSessionId::new();
        let result = service
            .open_managed_session(OpenManagedSession {
                id: Some(id),
                owner: Owner::User(sender()),
                repo_url: None,
                repo_branch: None,
                instructions: None,
                model: None,
                prompt: None,
                profile: Some(SelectedManagedPersona {
                    bot_id: bot_id::MACRO_CODER_BOT_ID,
                    profile: None,
                }),
            })
            .await;
        assert!(matches!(result, Err(AgentSessionError::Admission(error)) if error == failure));
        assert!(repo.get(id).await.is_err());
        assert_no_provisioning(&service);
    }
}

#[tokio::test]
async fn spending_actions_charge_the_persisted_owner_not_the_actor() {
    for failure in [denied(), AiAdmissionError::Unavailable] {
        for (bot, harness) in [
            (bot_id::MACRO_CODER_BOT_ID, "opencode"),
            (BotId::TEST_A, "macro-inmem"),
        ] {
            for action in [AgentAction::prompt("hello"), AgentAction::Compact] {
                let (service, repo, admission) = bench(Some(failure));
                let id = session(&repo, bot, harness, Owner::User(sender())).await;
                // Busy sessions must reject before accepting durable queued work too.
                service.inner.busy.admit(id);
                let result = service
                    .execute_here(id, HarnessCommand::Deliver(self::action(action)))
                    .await;
                assert!(matches!(result, Err(HarnessError::Admission(error)) if error == failure));
                assert!(repo.list_queued_actions(id).await.unwrap().is_empty());
                assert_eq!(
                    *admission.calls.lock().unwrap(),
                    [(sender().to_string(), AiFeature::AgentSession)]
                );
                assert_no_provisioning(&service);
            }
        }
    }
}

#[tokio::test]
async fn externally_funded_runtimes_accept_spending_actions_without_quota_io() {
    for harness in ["cursor", "codex-cloud", "claude-cloud", "macrod", "custom"] {
        let (service, repo, admission) = bench(Some(denied()));
        let id = session(&repo, BotId::TEST_A, harness, Owner::User(staff_sender())).await;
        service.inner.busy.admit(id);
        let result = service
            .execute_here(id, HarnessCommand::Deliver(action(AgentAction::Compact)))
            .await
            .unwrap();
        assert_eq!(result, CommandOutcome::Queued);
        assert!(admission.calls.lock().unwrap().is_empty());
        assert_eq!(repo.list_queued_actions(id).await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn external_open_does_not_check_runtime_quota() {
    let (service, _, admission) = bench(Some(denied()));
    service
        .open_external_session(open_external_request("/srv/agent"))
        .await
        .unwrap();
    assert!(admission.calls.lock().unwrap().is_empty());
    assert!(service.inner.egress.provisioned().is_empty());
}

#[tokio::test]
async fn unauthorized_forwarded_origin_is_rejected_before_billing_or_queueing() {
    let (service, repo, admission) = bench(Some(denied()));
    *service.inner.prompt_context.unauthorized.lock().unwrap() = Some("no access".into());
    let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
    service.inner.busy.admit(id);
    let result = super::super::ForwardedCommands::execute_forwarded(
        &service,
        id,
        HarnessCommand::Deliver(forward_message("hello")),
    )
    .await;
    assert!(matches!(result, Err(HarnessError::PromptContext(_))));
    assert!(admission.calls.lock().unwrap().is_empty());
    assert!(repo.list_queued_actions(id).await.unwrap().is_empty());
}

#[tokio::test]
async fn authorized_forwarded_commands_still_require_admission() {
    let (service, repo, admission) = bench(Some(denied()));
    let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
    let result = super::super::ForwardedCommands::execute_forwarded(
        &service,
        id,
        HarnessCommand::Deliver(forward_message("hello")),
    )
    .await;
    assert!(matches!(result, Err(HarnessError::Admission(_))));
    assert_eq!(admission.calls.lock().unwrap().len(), 1);
    assert_eq!(service.inner.prompt_context.authorized().len(), 1);
    let events = service.inner.lifecycle_publisher.published();
    assert!(
        matches!(events.as_slice(), [AgentSessionLifecycleEvent::CommandRejected(event)]
        if event.failure.code == denied().code() && !event.failure.retryable)
    );
    assert_no_provisioning(&service);
}

#[tokio::test]
async fn staff_and_non_user_owner_restrictions_precede_quota() {
    let (service, repo, admission) = bench(Some(denied()));
    let id = session(
        &repo,
        bot_id::MACRO_CODER_BOT_ID,
        "opencode",
        Owner::User(sender()),
    )
    .await;
    let mut command = action(AgentAction::Compact);
    command.actor = Some(sender());
    assert!(matches!(
        service
            .execute_here(id, HarnessCommand::Deliver(command))
            .await,
        Err(HarnessError::Session(AgentSessionError::Forbidden))
    ));
    let id = session(&repo, BotId::TEST_A, "in-memory", Owner::Bot(BotId::TEST_A)).await;
    assert!(matches!(
        service
            .execute_here(id, HarnessCommand::Deliver(action(AgentAction::Compact)))
            .await,
        Err(HarnessError::Session(AgentSessionError::OwnerNotUser(_)))
    ));
    assert!(admission.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn retries_of_queued_and_in_flight_actions_do_not_recheck_quota() {
    let (service, repo, admission) = bench(None);
    let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
    service.inner.busy.admit(id);
    let command = action(AgentAction::Compact);
    assert_eq!(
        service
            .execute_here(id, HarnessCommand::Deliver(command.clone()))
            .await
            .unwrap(),
        CommandOutcome::Queued
    );
    *admission.failure.lock().unwrap() = Some(denied());
    assert_eq!(
        service
            .execute_here(id, HarnessCommand::Deliver(command.clone()))
            .await
            .unwrap(),
        CommandOutcome::Queued
    );
    assert_eq!(repo.list_queued_actions(id).await.unwrap().len(), 1);
    // A fresh replica recognizes a durable queued retry as already admitted.
    let restarted = harness_sharing_repo(repo.clone()).with_admission(admission.clone());
    assert_eq!(
        restarted
            .execute_here(id, HarnessCommand::Deliver(command.clone()))
            .await
            .unwrap(),
        CommandOutcome::Queued
    );
    let entry = service.inner.queues.claim_next(id).unwrap();
    service.inner.busy.mark_turn(
        id,
        crate::domain::queue::InFlightTurn {
            action_id: entry.action_id,
            turn: agent_fold::domain::model::TurnId(0),
            actor: entry.actor,
            announce: None,
            announcement_message_id: None,
            dispatched_at: chrono::Utc::now(),
        },
    );
    assert_eq!(
        service
            .execute_here(id, HarnessCommand::Deliver(command))
            .await
            .unwrap(),
        CommandOutcome::Completed
    );
    assert_eq!(admission.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn non_spending_controls_and_queue_removal_remain_available() {
    let (service, repo, admission) = bench(None);
    let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
    service.inner.busy.admit(id);
    let command = action(AgentAction::Compact);
    service
        .execute_here(id, HarnessCommand::Deliver(command.clone()))
        .await
        .unwrap();
    *admission.failure.lock().unwrap() = Some(denied());
    assert_eq!(service.queued_controls(id).await.unwrap().len(), 1);
    service
        .remove_queued_control(id, command.id, Some(sender()))
        .await
        .unwrap();
    assert!(service.queued_controls(id).await.unwrap().is_empty());
    // A disconnected runtime can still refuse these, but quota must not.
    for action in [AgentAction::Stop, permission_answer("permission", "once")] {
        let result = service
            .execute_here(id, HarnessCommand::Deliver(self::action(action)))
            .await;
        assert!(!matches!(result, Err(HarnessError::Admission(_))));
    }
    assert_eq!(admission.calls.lock().unwrap().len(), 1);
}

async fn enqueue_waiting(service: &TestHarness, id: AgentSessionId) -> Vec<AgentActionId> {
    service.inner.busy.admit(id);
    let mut ids = Vec::new();
    for prompt in ["first", "second"] {
        let command = forward_message(prompt);
        ids.push(command.id);
        assert_eq!(
            service
                .execute_here(id, HarnessCommand::Deliver(command))
                .await
                .unwrap(),
            CommandOutcome::Queued
        );
    }
    ids
}

fn turn_ended() -> HarnessCommand {
    HarnessCommand::Turn(TurnSignal::TurnEnded {
        turn: agent_fold::domain::model::TurnId(0),
        action_id: None,
        stop: agent_fold::domain::model::StopReason::EndTurn,
        last_text: None,
    })
}

fn rejected_ids(service: &TestHarness) -> Vec<AgentActionId> {
    service
        .inner
        .lifecycle_publisher
        .published()
        .into_iter()
        .filter_map(|event| match event {
            AgentSessionLifecycleEvent::CommandRejected(event) => {
                assert_eq!(event.failure.code, denied().code());
                assert!(!event.failure.retryable);
                Some(event.action_id)
            }
            AgentSessionLifecycleEvent::TurnStarted(_) => panic!("rejected work started a turn"),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn enqueue_then_exhaust_rejects_all_waiting_work_once_even_after_restart() {
    for restart in [false, true] {
        let (service, repo, admission) = bench(None);
        let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
        let ids = enqueue_waiting(&service, id).await;
        *admission.failure.lock().unwrap() = Some(denied());
        let service = if restart {
            harness_sharing_repo(repo.clone()).with_admission(admission.clone())
        } else {
            service
        };
        assert!(matches!(service.execute_here(id, turn_ended()).await,
            Err(HarnessError::Admission(error)) if error == denied()));
        assert_eq!(rejected_ids(&service), ids);
        assert!(!service.inner.busy.is_pending(id));
        assert!(repo.list_queued_actions(id).await.unwrap().is_empty());
        assert!(service.inner.queues.list(id).is_empty());
        assert!(service.inner.prompt_composer.calls().is_empty());
        assert_no_provisioning(&service);
        // Empty-queue events neither recheck billing nor repeat rejection facts.
        let calls = admission.calls.lock().unwrap().len();
        service.execute_here(id, turn_ended()).await.unwrap();
        assert_eq!(admission.calls.lock().unwrap().len(), calls);
        assert_eq!(rejected_ids(&service), ids);
    }
}

#[tokio::test]
async fn billing_outage_preserves_fifo_and_retries_only_on_a_new_event() {
    let (service, repo, admission) = bench(None);
    let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
    let ids = enqueue_waiting(&service, id).await;
    *admission.failure.lock().unwrap() = Some(AiAdmissionError::Unavailable);
    for _ in 0..3 {
        let calls = admission.calls.lock().unwrap().len();
        assert!(matches!(
            service.execute_here(id, turn_ended()).await,
            Err(HarnessError::Admission(AiAdmissionError::Unavailable))
        ));
        tokio::task::yield_now().await;
        assert_eq!(admission.calls.lock().unwrap().len(), calls + 1);
        assert!(!service.inner.busy.is_pending(id));
        assert_eq!(
            repo.list_queued_actions(id)
                .await
                .unwrap()
                .iter()
                .map(|entry| entry.action_id)
                .collect::<Vec<_>>(),
            ids
        );
        assert!(service.inner.lifecycle_publisher.published().is_empty());
        assert!(service.inner.prompt_composer.calls().is_empty());
        assert_no_provisioning(&service);
    }
    let restarted = harness_sharing_repo(repo.clone()).with_admission(admission.clone());
    assert!(matches!(
        restarted.execute_here(id, turn_ended()).await,
        Err(HarnessError::Admission(AiAdmissionError::Unavailable))
    ));
    *admission.failure.lock().unwrap() = Some(denied());
    assert!(restarted.execute_here(id, turn_ended()).await.is_err());
    assert_eq!(rejected_ids(&restarted), ids);
}

#[tokio::test]
async fn steering_during_a_billing_outage_preserves_the_waiting_order() {
    let (service, repo, admission) = bench(None);
    let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
    let ids = enqueue_waiting(&service, id).await;
    *admission.failure.lock().unwrap() = Some(AiAdmissionError::Unavailable);

    assert!(matches!(
        service
            .execute_here(
                id,
                HarnessCommand::SteerQueued {
                    action_id: ids[1],
                    actor: Some(sender()),
                },
            )
            .await,
        Err(HarnessError::Admission(AiAdmissionError::Unavailable))
    ));
    assert_eq!(
        service
            .inner
            .queues
            .list(id)
            .iter()
            .map(|entry| entry.action_id)
            .collect::<Vec<_>>(),
        ids
    );
    assert_eq!(
        repo.list_queued_actions(id)
            .await
            .unwrap()
            .iter()
            .map(|entry| entry.action_id)
            .collect::<Vec<_>>(),
        ids
    );
    assert_no_provisioning(&service);
}

#[tokio::test]
async fn admission_changes_during_dispatch_never_reach_the_runtime() {
    for failure in [denied(), AiAdmissionError::Unavailable] {
        // Fail before composition, before announcement, or after announcement
        // immediately before delivery. The last case must clean up the reply.
        for allowed_checks in 0..3 {
            let (service, repo, admission) = bench(None);
            let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
            let ids = enqueue_waiting(&service, id).await;
            *admission.failure.lock().unwrap() = Some(failure);
            admission
                .responses
                .lock()
                .unwrap()
                .extend(vec![None; allowed_checks]);
            assert!(matches!(service.execute_here(id, turn_ended()).await,
                Err(HarnessError::Admission(error)) if error == failure));
            assert!(!service.inner.busy.is_pending(id));
            assert_eq!(service.inner.containers.resumed(), 0);
            assert!(service.inner.egress.provisioned().is_empty());
            assert_eq!(
                service.inner.prompt_composer.calls().len(),
                usize::from(allowed_checks > 0)
            );
            let announced = service.inner.announcer.announced_messages();
            assert_eq!(announced.len(), usize::from(allowed_checks == 2));
            let remaining = repo.list_queued_actions(id).await.unwrap();
            if failure.is_retryable() {
                assert_eq!(
                    remaining
                        .iter()
                        .map(|entry| entry.action_id)
                        .collect::<Vec<_>>(),
                    ids
                );
                assert_eq!(
                    remaining[0].announced_message_id,
                    announced.first().map(|message| message.message_id)
                );
                assert!(service.inner.lifecycle_publisher.published().is_empty());
                assert!(service.inner.announcer.resolved().is_empty());
                // Retry while still unavailable must not compose or announce again.
                assert!(service.execute_here(id, turn_ended()).await.is_err());
                assert_eq!(service.inner.announcer.announced_messages(), announced);
                *admission.failure.lock().unwrap() = Some(denied());
                assert!(service.execute_here(id, turn_ended()).await.is_err());
            } else {
                assert!(remaining.is_empty());
            }
            assert_eq!(rejected_ids(&service), ids);
            let resolved = service.inner.announcer.resolved();
            assert_eq!(resolved.len(), announced.len());
            if let Some(reply) = resolved.first() {
                assert_eq!(reply.message_id, announced[0].message_id);
                assert_eq!(reply.outcome, crate::domain::model::ReplyOutcome::Failed);
            }
        }
    }
}

#[tokio::test]
async fn denying_a_steering_follow_up_does_not_cancel_the_running_turn() {
    let (service, repo, admission) = bench(None);
    let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
    let running = crate::domain::queue::InFlightTurn {
        action_id: AgentActionId::mint(),
        turn: agent_fold::domain::model::TurnId(0),
        actor: Some(sender()),
        announce: None,
        announcement_message_id: None,
        dispatched_at: chrono::Utc::now(),
    };
    service.inner.busy.mark_turn(id, running.clone());
    // Enqueue succeeds, but steering's revalidation denies before Stop or chip.
    admission.responses.lock().unwrap().push_back(None);
    *admission.failure.lock().unwrap() = Some(denied());
    let command = forward_message("interrupt");
    let action_id = command.id;
    assert!(matches!(
        service
            .execute_here(id, HarnessCommand::Deliver(command))
            .await,
        Err(HarnessError::Admission(_))
    ));
    assert_eq!(
        service.inner.busy.turn(id).unwrap().action_id,
        running.action_id
    );
    assert_eq!(rejected_ids(&service), [action_id]);
    assert!(repo.list_queued_actions(id).await.unwrap().is_empty());
    assert_no_provisioning(&service);
}

#[tokio::test]
async fn restored_announced_work_resolves_without_inventing_a_turn() {
    let (service, repo, admission) = bench(None);
    let id = session(&repo, BotId::TEST_A, "in-memory", Owner::User(sender())).await;
    let ids = enqueue_waiting(&service, id).await;
    // The prompt was announced but billing failed immediately before dispatch.
    admission.responses.lock().unwrap().extend([None, None]);
    *admission.failure.lock().unwrap() = Some(AiAdmissionError::Unavailable);
    assert!(service.execute_here(id, turn_ended()).await.is_err());
    let announcement = service.inner.announcer.announced_messages()[0];
    let restarted = harness_sharing_repo(repo.clone()).with_admission(admission.clone());
    *admission.failure.lock().unwrap() = Some(denied());
    assert!(restarted.execute_here(id, turn_ended()).await.is_err());
    assert_eq!(rejected_ids(&restarted), ids);
    let resolved = restarted.inner.announcer.resolved();
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].message_id, announcement.message_id);
    assert!(repo.list_queued_actions(id).await.unwrap().is_empty());
    assert_no_provisioning(&restarted);
}

#[tokio::test]
async fn recovery_dispatches_the_original_head_without_duplicate_announcements() {
    let (service, repo, admission) = bench(None);
    let id = disconnected_session(&repo, &service.inner.containers).await;
    let ids = enqueue_waiting(&service, id).await;
    admission.responses.lock().unwrap().extend([None, None]);
    *admission.failure.lock().unwrap() = Some(AiAdmissionError::Unavailable);
    assert!(service.execute_here(id, turn_ended()).await.is_err());
    assert_eq!(service.inner.announcer.announced().len(), 1);
    assert_eq!(service.inner.containers.resumed(), 0);
    *admission.failure.lock().unwrap() = None;
    let dispatch = service.execute_here(id, turn_ended());
    let resume = async {
        while service.inner.containers.resumed() == 0 {
            tokio::task::yield_now().await;
        }
        let container = service.inner.containers.container(id).unwrap();
        complete_resume(&container).await;
        container.agent().wait_for_requests(3).await;
        container
    };
    let (result, container) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        tokio::join!(dispatch, resume)
    })
    .await
    .unwrap();
    result.unwrap();
    assert_eq!(
        prompts(&container.agent()),
        [vec![ContentBlock::from(context_prompt("first"))]]
    );
    assert_eq!(service.inner.busy.turn(id).unwrap().action_id, ids[0]);
    let remaining = repo.list_queued_actions(id).await.unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].action_id, ids[1]);
    assert_eq!(service.inner.announcer.announced().len(), 1);
    assert!(service.inner.announcer.resolved().is_empty());
}

#[tokio::test]
async fn rejection_persistence_failure_keeps_work_and_defers_reply_resolution() {
    use crate::domain::queue::QueuedEntry;
    use agent_session::domain::service::MockAgentSessionService;

    for reload_fails in [false, true] {
        let id = AgentSessionId::new();
        let command = forward_message("keep until the rejection is durable");
        let entry = QueuedEntry {
            action_id: command.id,
            action: command.action,
            actor: command.actor,
            announce: command.announce,
            announced: Some(macro_uuid::generate_uuid_v7()),
            created_at: chrono::Utc::now(),
        };
        let stored = entry.to_stored().unwrap();
        let mut sessions = MockAgentSessionService::new();
        sessions
            .expect_replace_queued_actions()
            .times(2)
            .returning(|_, entries| {
                assert!(entries.is_empty());
                Box::pin(async {
                    Err(AgentSessionError::Unknown(anyhow::anyhow!(
                        "write unavailable"
                    )))
                })
            });
        sessions
            .expect_list_queued_actions()
            .times(2)
            .returning(move |_| {
                let stored = stored.clone();
                Box::pin(async move {
                    if reload_fails {
                        Err(AgentSessionError::Unknown(anyhow::anyhow!(
                            "read unavailable"
                        )))
                    } else {
                        Ok(vec![stored])
                    }
                })
            });
        let service = AgentHarnessService::new(
            sessions,
            MockContainerManager::new(),
            AnnouncerMock::new(),
            TestConnections::new(MirrorBindings, RuntimeRegistry::new()),
            PromptContextMock::default(),
            PromptComposerMock::default(),
            EgressProvisionerMock::new(),
            NoPeers,
            KindDefaultPolicies,
            HarnessDefaultCodingAgents,
            HarnessDefaults::new(SessionDefaults {
                bot_id: BotId::TEST_A,
                model: "model".into(),
                harness: "in-memory".into(),
                repo_url: None,
            }),
            RecordingLifecyclePublisher::new(),
            crate::domain::pending::PendingCommands::new(),
            PromptMentionsMock::new(),
            NotifierMock::new(),
        );
        service.inner.queues.enqueue(id, entry.clone()).unwrap();
        service.inner.busy.admit(id);
        for _ in 0..2 {
            assert!(matches!(
                service
                    .inner
                    .reject_waiting_on_denial(id, &HarnessError::Admission(denied()))
                    .await,
                Err(HarnessError::Session(AgentSessionError::Unknown(_)))
            ));
            assert!(!service.inner.busy.is_pending(id));
            let waiting = service.inner.queues.snapshot(id);
            assert_eq!(waiting.len(), 1);
            assert_eq!(waiting[0].action_id, entry.action_id);
            assert_eq!(waiting[0].announced, entry.announced);
            assert!(service.inner.lifecycle_publisher.published().is_empty());
            assert!(service.inner.announcer.resolved().is_empty());
        }
    }
}

#[test]
fn admission_errors_keep_the_session_error_classification() {
    for failure in [denied(), AiAdmissionError::Unavailable] {
        assert!(
            matches!(into_session_error(HarnessError::Admission(failure)),
            AgentSessionError::Admission(error) if error == failure)
        );
    }
}
