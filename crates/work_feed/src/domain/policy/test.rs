use super::*;
use crate::domain::test_support::viewer_id;

#[test]
fn no_types_means_every_type() {
    assert_eq!(
        candidate_types(&[]),
        WorkFeedItemType::ALL
            .iter()
            .map(|item_type| item_type.entity_type())
            .collect::<Vec<_>>()
    );
}

#[test]
fn types_keep_request_order_without_duplicates() {
    assert_eq!(
        candidate_types(&[
            WorkFeedItemType::Email,
            WorkFeedItemType::Document,
            WorkFeedItemType::Email,
        ]),
        vec![EntityType::EmailThread, EntityType::Document]
    );
}

#[test]
fn signal_filter_matches_home_signal() {
    let filter = signal_filter(&viewer_id(), false);
    assert!(filter.document_filter.is_some(), "snippets are excluded");
    assert!(
        filter.agent_session_filter.is_some(),
        "agent sessions are opted in"
    );
    assert!(filter.initiative_filter.is_none(), "initiatives stay out");
    assert!(filter.email_filter.tree.is_some());
    assert!(filter.channel_thread_filter.is_some());
    assert!(filter.foreign_entity_filter.is_some());

    let with_snippets = signal_filter(&viewer_id(), true);
    assert!(with_snippets.document_filter.is_none());
}
