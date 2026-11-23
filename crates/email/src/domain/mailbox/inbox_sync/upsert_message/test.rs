use super::*;
#[test]
fn selects_draft_sync_for_new_draft() {
    assert_eq!(
        select_message_sync_event(None, true, false),
        Some(MessageSyncEventKind::DraftSynced)
    );
}

#[test]
fn selects_draft_sync_for_draft_edit() {
    assert_eq!(
        select_message_sync_event(Some(true), true, false),
        Some(MessageSyncEventKind::DraftSynced)
    );
}

#[test]
fn selects_sent_for_provider_draft_to_sent_transition() {
    assert_eq!(
        select_message_sync_event(Some(true), false, true),
        Some(MessageSyncEventKind::Sent)
    );
}

#[test]
fn selects_sent_for_new_sent_message() {
    assert_eq!(
        select_message_sync_event(None, false, true),
        Some(MessageSyncEventKind::Sent)
    );
}

#[test]
fn selects_received_for_new_received_message() {
    assert_eq!(
        select_message_sync_event(None, false, false),
        Some(MessageSyncEventKind::Received)
    );
}

#[test]
fn suppresses_existing_immutable_non_drafts() {
    assert_eq!(select_message_sync_event(Some(false), false, false), None);
    assert_eq!(select_message_sync_event(Some(false), false, true), None);
}
