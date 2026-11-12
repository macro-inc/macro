//! Runtime access is checked when a prompt is accepted and again when it
//! dispatches, so access removed while a prompt waits stops it too.

use super::*;
use crate::domain::model::{ReplyOutcome, RuntimeAccessFacts};
use model_owner::Owner;

fn resident_facts(agent_owner_may_use: bool) -> RuntimeAccessFacts {
    RuntimeAccessFacts {
        runtime_name: "Studio Mac".to_owned(),
        resident: true,
        agent_owner_may_use,
        actor_may_use: Some(true),
    }
}

async fn external_session(repo: &InMemoryAgentSessionRepo) -> AgentSessionId {
    let id = AgentSessionId::new();
    agent_session::domain::ports::AgentSessionRepo::create(
        repo,
        CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            id,
            owner_id: Owner::User(sender()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "model".into(),
            harness: "macrod".into(),
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

fn turn_ended() -> HarnessCommand {
    HarnessCommand::Turn(TurnSignal::TurnEnded {
        notification_noop: false,
        turn: agent_fold::domain::model::TurnId(0),
        action_id: None,
        stop: agent_fold::domain::model::StopReason::EndTurn,
        last_text: None,
    })
}

#[tokio::test]
async fn a_prompt_queued_before_access_was_removed_never_runs() {
    let repo = InMemoryAgentSessionRepo::new();
    let bindings = MirrorBindings::default();
    *bindings.facts.lock().unwrap() = Some(resident_facts(true));
    let service = harness_sharing_repo_with_bindings(repo.clone(), bindings.clone());
    let id = external_session(&repo).await;

    // A turn is running, so the prompt waits behind it.
    service.inner.busy.admit(id);
    let prompt = forward_message("hello");
    assert_eq!(
        service
            .execute_here(id, HarnessCommand::Deliver(prompt.clone()))
            .await
            .unwrap(),
        CommandOutcome::Queued
    );

    // The owner loses access while it waits; the running turn then ends.
    *bindings.facts.lock().unwrap() = Some(resident_facts(false));
    service.execute_here(id, turn_ended()).await.unwrap();

    assert!(
        service.inner.prompt_composer.calls().is_empty(),
        "the refused prompt was never composed for the runtime"
    );
    assert!(repo.list_queued_actions(id).await.unwrap().is_empty());
    assert!(!service.inner.busy.is_pending(id));
    let rejected = service
        .inner
        .lifecycle_publisher
        .published()
        .into_iter()
        .filter_map(|event| match event {
            AgentSessionLifecycleEvent::CommandRejected(event) => Some(event),
            AgentSessionLifecycleEvent::TurnStarted(_) => panic!("a refused prompt started a turn"),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(rejected.len(), 1);
    assert_eq!(rejected[0].action_id, prompt.id);
    assert_eq!(rejected[0].failure.code, "no_runtime_access");
    assert!(!rejected[0].failure.retryable);

    // The conversation it came from hears why, once.
    let presented = service.inner.announcer.presented();
    assert_eq!(presented.len(), 1);
    assert_eq!(
        presented[0].outcome,
        Some(ReplyOutcome::Refused(
            "This agent has stopped: its owner no longer has access to Studio Mac.".to_owned()
        ))
    );
    assert_eq!(
        presented[0].parent,
        MessageParent::Channel(macro_uuid::Uuid::from_u128(0xf0))
    );
}

#[tokio::test]
async fn a_prompt_sent_after_access_was_removed_is_refused_with_the_reason() {
    let repo = InMemoryAgentSessionRepo::new();
    let bindings = MirrorBindings::default();
    *bindings.facts.lock().unwrap() = Some(resident_facts(false));
    let service = harness_sharing_repo_with_bindings(repo.clone(), bindings);
    let id = external_session(&repo).await;

    let result = service
        .execute_here(id, HarnessCommand::Deliver(forward_message("hello")))
        .await;

    assert!(matches!(
        result,
        Err(HarnessError::Session(AgentSessionError::NoRuntimeAccess(reason)))
            if reason == "This agent has stopped: its owner no longer has access to Studio Mac."
    ));
    assert!(repo.list_queued_actions(id).await.unwrap().is_empty());
    assert_eq!(service.inner.announcer.presented().len(), 1);
}
