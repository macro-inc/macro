use attention_feed::test_support::at;
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::domain::models::{ClearStatus, InboxRowType, InboxScope};

#[test]
fn the_update_names_the_clear_and_its_revision_only() {
    let id = Uuid::from_u128(7);
    let action = ClearAction {
        id,
        status: ClearStatus::Undoing,
        scope: InboxScope {
            row_types: vec![InboxRowType::Task],
            unread_only: false,
        },
        since: None,
        as_of: at(0),
        rows: 12,
        notifications: 30,
        restored: 4,
        revision: 9,
    };
    assert_eq!(
        payload(&action),
        json!({ "clearId": id, "status": "undoing", "revision": 9 })
    );
}
