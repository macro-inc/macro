use super::*;

fn connection(enabled: bool, last_error: Option<SyncIssue>) -> Connection {
    Connection {
        id: Uuid::from_u128(1),
        namespace: Uuid::from_u128(1),
        user_id: macro_user_id::cowlike::CowLike::into_owned(
            MacroUserIdStr::parse_from_str("macro|dialpad-a@example.com").unwrap(),
        ),
        enabled,
        dialpad_user_id: None,
        registration: None,
        secret: None,
        backfill: BackfillState::Done,
        enrolled_at: chrono::Utc::now(),
        last_synced_at: None,
        last_error,
    }
}

#[test]
fn status_reflects_setup_and_issues() {
    assert_eq!(status_of(None), SyncStatus::NotConnected);
    assert_eq!(
        status_of(Some(connection(false, None))),
        SyncStatus::Connecting
    );
    assert_eq!(
        status_of(Some(connection(false, Some(SyncIssue::NeedsReauth)))),
        SyncStatus::Failed {
            issue: SyncIssue::NeedsReauth
        }
    );
    assert_eq!(
        status_of(Some(connection(true, Some(SyncIssue::CallSyncFailed)))),
        SyncStatus::Connected {
            last_synced_at: None,
            issue: Some(SyncIssue::CallSyncFailed)
        }
    );
}
