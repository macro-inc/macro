use harnesses::domain::models::{Harness, HarnessOwner};
use harnesses::domain::ports::MockHarnessRepo;

use super::*;

fn harness(id: HarnessId, connected: bool) -> Harness {
    Harness {
        allow_permission_bypass: false,
        id,
        kind: "macrod".into(),
        name: "Private runtime behind a shared persona".into(),
        owner: HarnessOwner::User {
            user_id: "macro|persona-owner@example.com".into(),
        },
        created_by: "macro|persona-owner@example.com".into(),
        created_at: "2026-10-02T00:00:00Z".parse().unwrap(),
        updated_at: "2026-10-02T00:00:00Z".parse().unwrap(),
        connected,
        last_connected_at: None,
    }
}

#[tokio::test]
async fn authorized_shared_personas_need_no_permission_to_list_their_private_harness() {
    let mut repo = MockHarnessRepo::new();
    repo.expect_get_harness()
        .withf(|id| *id == HarnessId::TEST_A)
        .times(1)
        .returning(|id| Box::pin(async move { Ok(Some(harness(id, true))) }));
    // No list_visible_harnesses call is permitted: a channel participant may
    // start the shared persona without owning or administering its runtime.
    let connections = RuntimeConnections {
        harnesses: connected_harnesses(&repo, [HarnessId::TEST_A, HarnessId::TEST_A])
            .await
            .unwrap(),
        ..Default::default()
    };
    assert!(connections.available("macrod", Some(HarnessId::TEST_A)));
    assert!(!connections.available("macrod", Some(HarnessId::TEST_B)));
    assert!(!connections.available("macrod", None));
}

#[tokio::test]
async fn disconnected_and_deleted_runtime_bindings_are_unavailable() {
    let mut repo = MockHarnessRepo::new();
    repo.expect_get_harness()
        .withf(|id| *id == HarnessId::TEST_A)
        .times(1)
        .returning(|id| Box::pin(async move { Ok(Some(harness(id, false))) }));
    repo.expect_get_harness()
        .withf(|id| *id == HarnessId::TEST_B)
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    let connections = RuntimeConnections {
        harnesses: connected_harnesses(&repo, [HarnessId::TEST_A, HarnessId::TEST_B])
            .await
            .unwrap(),
        ..Default::default()
    };
    assert!(!connections.available("macrod", Some(HarnessId::TEST_A)));
    assert!(!connections.available("macrod", Some(HarnessId::TEST_B)));
}

#[test]
fn one_provider_connection_does_not_enable_another_provider() {
    let connections = RuntimeConnections {
        cursor: true,
        ..Default::default()
    };
    assert!(connections.available("cursor", None));
    assert!(!connections.available("codex-cloud", None));
    assert!(!connections.available("claude-cloud", None));
    assert!(!connections.available("unknown-runtime", None));
    assert!(connections.available("in-memory", None));
    assert!(connections.available("macro-inmem", None));
    assert!(!RuntimeConnections::default().available("cursor", None));
}

#[test]
fn codex_requires_both_a_connection_and_an_environment() {
    let mut status = codex_connection::domain::ConnectionStatus {
        connected: true,
        account_id: None,
        environment_id: None,
    };
    assert!(!codex_available(&status));
    status.environment_id = Some("configured-environment".into());
    assert!(codex_available(&status));
    status.connected = false;
    assert!(!codex_available(&status));
}
