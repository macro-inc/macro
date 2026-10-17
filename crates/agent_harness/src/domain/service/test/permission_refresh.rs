//! A changed permission policy reaches a live session before its next prompt,
//! so withdrawing bypass does not wait for the session to reattach.

use std::sync::Mutex;

use super::*;
use crate::domain::model::PermissionPolicyConfig;

#[derive(Clone)]
struct ChangeablePolicy(Arc<Mutex<PermissionPolicyConfig>>);

impl crate::domain::ports::PermissionPolicySource for ChangeablePolicy {
    async fn permission_policy(&self, _: BotId) -> anyhow::Result<PermissionPolicyConfig> {
        Ok(self.0.lock().unwrap().clone())
    }
}

fn persona_on_harness(harness_allows_bypass: bool) -> PermissionPolicyConfig {
    PermissionPolicyConfig::Persona {
        kind: AgentKind::External,
        harness_allows_bypass: Some(harness_allows_bypass),
        auto_accept_permissions: Some(true),
    }
}

#[tokio::test]
async fn a_withdrawn_bypass_reaches_a_live_session_before_its_next_prompt() {
    let policy = ChangeablePolicy(Arc::new(Mutex::new(persona_on_harness(true))));
    let ((service, _repo, containers, _announcer, _runtimes), mut turns) = harness_with_policy(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        policy.clone(),
    );
    let id = AgentSessionId::new();
    let container = live_sandboxed_coder_session(&service, &containers, id).await;
    turns.settled(id).await;
    let agent = container.agent();
    agent.sends_raw(permission_request("before"));
    agent.wait_for_responses(1).await;
    assert_eq!(
        permission_outcome(&agent, "before"),
        Some(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new("always")
        ))
    );

    *policy.0.lock().unwrap() = persona_on_harness(false);
    let prompted = service.execute(id, HarnessCommand::Deliver(forward_message("keep going")));
    let answered = async {
        agent.wait_for_requests(4).await;
        agent.completes_prompt().await;
    };
    let (prompted, ()) = tokio::join!(prompted, answered);
    prompted.expect("the prompt reaches the session");

    agent.sends_raw(permission_request("after"));
    service
        .control_event(
            id,
            ControlEvent {
                action_id: None,
                action: permission_answer("after", "once"),
                actor: Some(staff_sender()),
                context: None,
            },
        )
        .await
        .expect("the request waits for a user's answer");
    assert_eq!(
        permission_outcome(&agent, "after"),
        Some(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new("once")
        ))
    );
}
