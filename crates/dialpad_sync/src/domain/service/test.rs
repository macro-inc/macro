use super::*;

fn connection(enabled: bool, last_error: Option<SyncIssue>) -> Connection {
    Connection {
        id: Uuid::from_u128(1),
        namespace: Uuid::from_u128(1),
        user_id: macro_user_id::cowlike::CowLike::into_owned(
            MacroUserIdStr::parse_from_str("macro|dialpad-a@example.com").unwrap(),
        ),
        enabled,
        setup_lease: None,
        dialpad_user_id: None,
        registration: None,
        secret: None,
        backfill: BackfillState::Done,
        enrolled_at: chrono::Utc::now(),
        last_synced_at: None,
        last_error,
        calls: CallHealth::Healthy,
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
    let issue = |last_error, calls| match status_of(Some(Connection {
        calls,
        ..connection(true, last_error)
    })) {
        SyncStatus::Connected { issue, .. } => issue,
        status => panic!("expected a running sync, got {status:?}"),
    };
    assert_eq!(issue(None, CallHealth::Healthy), None);
    assert_eq!(
        issue(None, CallHealth::Retrying),
        Some(SyncIssue::CallSyncFailed)
    );
    assert_eq!(
        issue(None, CallHealth::Abandoned),
        Some(SyncIssue::CallsAbandoned)
    );
    // A reconnect prompt outranks call failures.
    assert_eq!(
        issue(Some(SyncIssue::NeedsReauth), CallHealth::Abandoned),
        Some(SyncIssue::NeedsReauth)
    );
}
