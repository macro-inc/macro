use super::{EmailBackfillStatus, EmailSyncStatus};

#[test]
fn inactive_sync_takes_precedence_over_other_facts() {
    assert_eq!(
        EmailSyncStatus::derive(false, true, Some(EmailBackfillStatus::InProgress)),
        EmailSyncStatus::Inactive
    );
}

#[test]
fn reauthorization_takes_precedence_over_active_backfill_state() {
    assert_eq!(
        EmailSyncStatus::derive(true, true, Some(EmailBackfillStatus::InProgress)),
        EmailSyncStatus::NeedsReauth
    );
}

#[test]
fn backfill_status_maps_to_the_user_facing_sync_state() {
    for status in [EmailBackfillStatus::Init, EmailBackfillStatus::InProgress] {
        assert_eq!(
            EmailSyncStatus::derive(true, false, Some(status)),
            EmailSyncStatus::Syncing
        );
    }

    for status in [EmailBackfillStatus::Failed, EmailBackfillStatus::Cancelled] {
        assert_eq!(
            EmailSyncStatus::derive(true, false, Some(status)),
            EmailSyncStatus::Error
        );
    }

    assert_eq!(
        EmailSyncStatus::derive(true, false, Some(EmailBackfillStatus::Complete)),
        EmailSyncStatus::UpToDate
    );
    assert_eq!(
        EmailSyncStatus::derive(true, false, None),
        EmailSyncStatus::UpToDate
    );
}
