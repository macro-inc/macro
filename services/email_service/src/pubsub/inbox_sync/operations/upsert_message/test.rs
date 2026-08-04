use super::*;

fn id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

#[test]
fn includes_owner_and_all_delegated_primaries() {
    let owner = id("macro|owner@x.com");
    let recipients = build_notification_recipients(
        &owner,
        vec![
            "macro|primary-a@x.com".to_string(),
            "macro|primary-b@x.com".to_string(),
        ],
    );

    assert_eq!(
        recipients,
        HashSet::from([
            owner,
            id("macro|primary-a@x.com"),
            id("macro|primary-b@x.com"),
        ])
    );
}

#[test]
fn returns_only_owner_when_no_primaries() {
    let owner = id("macro|owner@x.com");
    let recipients = build_notification_recipients(&owner, vec![]);

    assert_eq!(recipients, HashSet::from([owner]));
}

#[test]
fn skips_unparseable_primaries_keeping_valid_ones() {
    let owner = id("macro|owner@x.com");
    let recipients = build_notification_recipients(
        &owner,
        vec![
            "macro|primary-a@x.com".to_string(),
            "not-a-valid-id".to_string(),
        ],
    );

    assert_eq!(
        recipients,
        HashSet::from([owner, id("macro|primary-a@x.com")])
    );
}

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
