use attention_feed::test_support::uuid;
use model_entity::EntityType;

use super::*;

#[test]
fn row_ids_round_trip() {
    let id = InboxRowId {
        group: FeedKey::new(EntityType::Channel.with_entity_string(uuid(1).to_string())),
        slot: format!("thread:{}", uuid(2)),
    };
    let text = id.id();
    assert_eq!(text, format!("channel:{}#thread:{}", uuid(1), uuid(2)));
    assert_eq!(InboxRowId::parse(&text).unwrap(), id);
}

#[test]
fn malformed_row_ids_are_rejected() {
    for id in [
        "",
        "channel:x",
        "channel:x#",
        "#top_level",
        "not_a_type:x#top_level",
    ] {
        assert!(InboxRowId::parse(id).is_err(), "{id} parsed");
    }
}

fn bare_row(row_type: InboxRowType, unseen: bool) -> InboxRow {
    InboxRow {
        id: InboxRowId {
            group: FeedKey::new(EntityType::Channel.with_entity_string(uuid(1).to_string())),
            slot: "top_level".to_string(),
        },
        row_type,
        thread_id: None,
        actor: None,
        actions: Vec::new(),
        notifications: Vec::new(),
        hidden: Vec::new(),
        unseen,
    }
}

#[test]
fn an_empty_scope_admits_every_row_type() {
    assert!(InboxScope::default().admits(&bare_row(InboxRowType::Email, false)));
    let scope = InboxScope {
        row_types: vec![InboxRowType::Task],
        ..Default::default()
    };
    assert!(scope.admits(&bare_row(InboxRowType::Task, false)));
    assert!(!scope.admits(&bare_row(InboxRowType::Email, true)));
}

#[test]
fn an_unread_scope_admits_unread_rows_only() {
    let scope = InboxScope {
        unread_only: true,
        ..Default::default()
    };
    assert!(scope.admits(&bare_row(InboxRowType::Email, true)));
    assert!(!scope.admits(&bare_row(InboxRowType::Email, false)));
}
