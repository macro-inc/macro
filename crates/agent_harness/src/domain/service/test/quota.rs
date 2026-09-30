use super::*;
use ai_billing::{AdmissionFuture, AiAdmissionError, AiAdmissionService, DenyReason};
use ai_usage::AiFeature;
use model_owner::Owner;

#[derive(Default)]
struct AdmissionMock {
    failure: Mutex<Option<AiAdmissionError>>,
    calls: Mutex<Vec<(String, AiFeature)>>,
}

impl AiAdmissionService for AdmissionMock {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        self.calls.lock().unwrap().push((user.to_string(), feature));
        let failure = *self.failure.lock().unwrap();
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
    assert!(service.inner.lifecycle_publisher.published().is_empty());
}

#[tokio::test]
async fn denied_or_unavailable_mention_open_has_no_side_effects() {
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
            open.origin.sender = staff_sender();
            let id = AgentSessionId::new();
            let result = service.execute_here(id, HarnessCommand::Open(open)).await;
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
    open.origin.sender = staff_sender();
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

#[test]
fn admission_errors_keep_the_session_error_classification() {
    for failure in [denied(), AiAdmissionError::Unavailable] {
        assert!(
            matches!(into_session_error(HarnessError::Admission(failure)),
            AgentSessionError::Admission(error) if error == failure)
        );
    }
}
