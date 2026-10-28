use super::*;

#[test]
fn a_ping_stamped_ahead_of_this_instance_clock_is_active() {
    let entry = StoredConnectionEntity {
        pk: "#document#doc".to_owned(),
        sk: "connection".to_owned(),
        entity_type: EntityType::Document,
        entity_id: "doc".to_owned(),
        connection_id: "connection".to_owned(),
        created_at: 1_000_000,
        user_id: "macro|user@example.com".to_owned(),
        last_ping: Some(1_000_500),
    };

    assert!(entry.is_active_at(1_000_000, Some(60_000)));
}

#[test]
fn an_entry_not_pinged_within_the_threshold_is_inactive() {
    let entry = StoredConnectionEntity {
        pk: "#document#doc".to_owned(),
        sk: "connection".to_owned(),
        entity_type: EntityType::Document,
        entity_id: "doc".to_owned(),
        connection_id: "connection".to_owned(),
        created_at: 1_000_000,
        user_id: "macro|user@example.com".to_owned(),
        last_ping: Some(1_000_000),
    };

    assert!(entry.is_active_at(1_059_999, Some(60_000)));
    assert!(!entry.is_active_at(1_060_000, Some(60_000)));
}

#[test]
fn an_open_entry_never_pinged_counts_from_creation() {
    let entry = StoredConnectionEntity {
        pk: "#document#doc".to_owned(),
        sk: "connection".to_owned(),
        entity_type: EntityType::Document,
        entity_id: "doc".to_owned(),
        connection_id: "connection".to_owned(),
        created_at: 1_000_000,
        user_id: "macro|user@example.com".to_owned(),
        last_ping: None,
    };

    assert!(entry.is_active_at(999_000, Some(60_000)));
    assert!(!entry.is_active_at(1_060_000, Some(60_000)));
}
