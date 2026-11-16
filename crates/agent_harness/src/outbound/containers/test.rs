use super::*;
use crate::testing::helpers::egress::test_egress;

#[tokio::test]
async fn unavailable_preflight_blocks_sandboxed_sessions() {
    let owner = MacroUserIdStr::try_from_email("owner@example.com").expect("valid owner");

    let blocker = HarnessContainers::Unavailable
        .preflight(AgentKind::SandboxedCoder, &owner)
        .await
        .expect("preflight");

    assert!(matches!(blocker, Some(SessionBlocker::SandboxUnavailable)));
}

#[tokio::test]
async fn unavailable_teardown_succeeds() {
    HarnessContainers::Unavailable
        .teardown(AgentSessionId::new())
        .await
        .expect("teardown without a provider");
}

#[tokio::test]
async fn unavailable_spawn_fails() {
    let result = HarnessContainers::Unavailable
        .spawn(SpawnContainer {
            session_id: AgentSessionId::new(),
            kind: AgentKind::SandboxedCoder,
            size: SandboxSize::Default,
            egress: test_egress(),
        })
        .await;

    assert!(matches!(result, Err(HarnessError::Container(_))));
}

#[tokio::test]
async fn unavailable_resume_fails() {
    let result = HarnessContainers::Unavailable
        .resume(AgentSessionId::new())
        .await;

    assert!(matches!(result, Err(HarnessError::Container(_))));
}
