use super::*;

#[test]
fn inactive_link_is_inactive_regardless_of_reauth() {
    assert_eq!(SyncStatus::derive(false, false, None), SyncStatus::Inactive);
    assert_eq!(SyncStatus::derive(false, true, None), SyncStatus::Inactive);
}

#[test]
fn needs_reauth_takes_precedence_over_backfill_state() {
    assert_eq!(
        SyncStatus::derive(true, true, None),
        SyncStatus::NeedsReauth
    );
    assert_eq!(
        SyncStatus::derive(true, true, Some(BackfillJobStatus::InProgress)),
        SyncStatus::NeedsReauth
    );
    assert_eq!(
        SyncStatus::derive(true, true, Some(BackfillJobStatus::Complete)),
        SyncStatus::NeedsReauth
    );
}

#[test]
fn healthy_link_derives_from_backfill_state() {
    assert_eq!(SyncStatus::derive(true, false, None), SyncStatus::UpToDate);
    assert_eq!(
        SyncStatus::derive(true, false, Some(BackfillJobStatus::Complete)),
        SyncStatus::UpToDate
    );
    assert_eq!(
        SyncStatus::derive(true, false, Some(BackfillJobStatus::Init)),
        SyncStatus::Syncing
    );
    assert_eq!(
        SyncStatus::derive(true, false, Some(BackfillJobStatus::InProgress)),
        SyncStatus::Syncing
    );
    assert_eq!(
        SyncStatus::derive(true, false, Some(BackfillJobStatus::Failed)),
        SyncStatus::Error
    );
    assert_eq!(
        SyncStatus::derive(true, false, Some(BackfillJobStatus::Cancelled)),
        SyncStatus::Error
    );
}
