use super::*;

#[test]
fn provider_conversion_is_exhaustive() {
    assert_eq!(
        UserProvider::from(service::link::UserProvider::Gmail),
        UserProvider::Gmail
    );
    assert_eq!(
        UserProvider::from(service::link::UserProvider::Outlook),
        UserProvider::Outlook
    );
}

#[test]
fn provider_api_serialization_preserves_gmail_and_emits_outlook() {
    assert_eq!(
        serde_json::to_string(&UserProvider::Gmail).unwrap(),
        r#""GMAIL""#
    );
    assert_eq!(
        serde_json::to_string(&UserProvider::Outlook).unwrap(),
        r#""OUTLOOK""#
    );
}

#[test]
fn provider_database_names_are_uppercase() {
    assert_eq!(service::link::UserProvider::Gmail.as_str(), "GMAIL");
    assert_eq!(service::link::UserProvider::Outlook.as_str(), "OUTLOOK");
    assert_eq!(UserProvider::Gmail.as_str(), "GMAIL");
    assert_eq!(UserProvider::Outlook.as_str(), "OUTLOOK");
}

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
