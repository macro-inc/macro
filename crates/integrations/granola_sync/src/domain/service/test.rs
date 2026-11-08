use super::*;
use macro_user_id::cowlike::CowLike;

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@test.com"))
        .unwrap()
        .into_owned()
}
fn state(name: &str, account: &str) -> SyncState {
    SyncState {
        id: macro_uuid::generate_uuid_v7(),
        user_id: user(name),
        account_id: account.into(),
        scope: Scope::All,
        enabled: true,
        has_endpoint: true,
        started_at: chrono::Utc::now(),
        last_error: None,
    }
}

#[test]
fn connecting_an_account_starts_sync_without_user_action() {
    let plan = plan(&[(user("a"), "apn_a".into())], &[], chrono::Utc::now());
    assert_eq!(plan.start, vec![user("a")]);
    assert!(plan.stop.is_empty());
}

#[test]
fn an_active_sync_at_the_widest_scope_is_left_alone() {
    let plan = plan(
        &[(user("a"), "apn_a".into())],
        &[state("a", "apn_a")],
        chrono::Utc::now(),
    );
    assert_eq!(plan, Plan::default());
}

#[test]
fn removing_or_replacing_the_account_stops_the_old_sync() {
    let removed = state("a", "apn_a");
    let replaced = state("b", "apn_old");
    let plan = plan(
        &[(user("b"), "apn_new".into())],
        &[removed, replaced],
        chrono::Utc::now(),
    );
    assert_eq!(plan.stop.len(), 2);
    assert_eq!(plan.start, vec![user("b")]);
}

#[test]
fn narrower_scopes_from_earlier_settings_are_widened() {
    let plan = plan(
        &[(user("a"), "apn_a".into())],
        &[SyncState {
            scope: Scope::Personal,
            ..state("a", "apn_a")
        }],
        chrono::Utc::now(),
    );
    assert_eq!(plan.start, vec![user("a")]);
}

#[test]
fn failed_setups_wait_for_the_retry_delay_but_reconnects_restart_at_once() {
    let now = chrono::Utc::now();
    let failed = |issue: SyncIssue, age: chrono::Duration| SyncState {
        enabled: false,
        has_endpoint: false,
        started_at: now - age,
        last_error: Some(issue),
        ..state("a", "apn_a")
    };
    let accounts = [(user("a"), "apn_a".into())];
    let recent = failed(SyncIssue::SetupFailed, chrono::Duration::minutes(5));
    assert!(plan(&accounts, &[recent], now).start.is_empty());
    let old = failed(SyncIssue::SetupFailed, chrono::Duration::hours(2));
    assert_eq!(plan(&accounts, &[old], now).start.len(), 1);
    let stopped = failed(SyncIssue::Stopped, chrono::Duration::minutes(1));
    assert_eq!(plan(&accounts, &[stopped], now).start.len(), 1);
}

#[test]
fn an_in_flight_reservation_is_not_raced() {
    let now = chrono::Utc::now();
    let reserving = |age| SyncState {
        enabled: false,
        has_endpoint: false,
        started_at: now - age,
        ..state("a", "apn_a")
    };
    let accounts = [(user("a"), "apn_a".into())];
    let fresh = reserving(chrono::Duration::seconds(10));
    assert!(plan(&accounts, &[fresh], now).start.is_empty());
    let abandoned = reserving(chrono::Duration::minutes(5));
    assert_eq!(plan(&accounts, &[abandoned], now).start.len(), 1);
}
