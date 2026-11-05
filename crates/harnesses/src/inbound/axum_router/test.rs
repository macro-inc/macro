use axum::http::HeaderValue;
use chrono::Utc;

use super::*;
use crate::domain::models::{ClaudeMode, HarnessOwner};

fn harness(connected: bool) -> Harness {
    Harness {
        id: HarnessId::TEST_A,
        allow_permission_bypass: false,
        kind: "macrod".to_owned(),
        name: "desk".to_owned(),
        owner: HarnessOwner::User {
            user_id: "macro|owner@example.com".to_owned(),
        },
        created_by: "macro|owner@example.com".to_owned(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        connected,
        last_connected_at: None,
        capabilities: HarnessCapabilities::default(),
        computer_id: None,
        claude_mode: ClaudeMode::MacroCredits,
    }
}

#[test]
fn only_a_daemon_holding_a_connection_can_disagree_with_offline() {
    let mut holding = HeaderMap::new();
    holding.insert(RUNTIME_CONNECTED_HEADER, HeaderValue::from_static("true"));

    assert!(runtime_presence_disagrees(&holding, &harness(false)));
    assert!(!runtime_presence_disagrees(&holding, &harness(true)));
    assert!(!runtime_presence_disagrees(
        &HeaderMap::new(),
        &harness(false)
    ));
}
