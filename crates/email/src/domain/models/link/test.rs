use super::{EmailBackfillStatus, EmailSyncStatus};

#[test]
fn inactive_sync_takes_precedence_over_other_facts() {
    assert_eq!(
        EmailSyncStatus::derive(false, true, false, Some(EmailBackfillStatus::InProgress)),
        EmailSyncStatus::Inactive
    );
}

#[test]
fn reauthorization_takes_precedence_over_active_backfill_state() {
    assert_eq!(
        EmailSyncStatus::derive(true, true, false, Some(EmailBackfillStatus::InProgress)),
        EmailSyncStatus::NeedsReauth
    );
}

#[test]
fn backfill_status_maps_to_the_user_facing_sync_state() {
    for status in [EmailBackfillStatus::Init, EmailBackfillStatus::InProgress] {
        assert_eq!(
            EmailSyncStatus::derive(true, false, false, Some(status)),
            EmailSyncStatus::Syncing
        );
    }

    for status in [EmailBackfillStatus::Failed, EmailBackfillStatus::Cancelled] {
        assert_eq!(
            EmailSyncStatus::derive(true, false, false, Some(status)),
            EmailSyncStatus::Error
        );
    }

    assert_eq!(
        EmailSyncStatus::derive(true, false, false, Some(EmailBackfillStatus::Complete)),
        EmailSyncStatus::UpToDate
    );
    assert_eq!(
        EmailSyncStatus::derive(true, false, false, None),
        EmailSyncStatus::UpToDate
    );
}

#[test]
fn a_missing_mailbox_takes_precedence_over_backfill_state_but_not_reauthorization() {
    assert_eq!(
        EmailSyncStatus::derive(true, false, true, Some(EmailBackfillStatus::InProgress)),
        EmailSyncStatus::MailboxUnavailable
    );
    assert_eq!(
        EmailSyncStatus::derive(true, true, true, Some(EmailBackfillStatus::InProgress)),
        EmailSyncStatus::NeedsReauth
    );
    assert_eq!(
        EmailSyncStatus::derive(false, false, true, None),
        EmailSyncStatus::Inactive
    );
}
