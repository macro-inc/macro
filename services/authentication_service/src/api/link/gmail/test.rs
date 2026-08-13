use super::*;
use std::cell::Cell;

/// Stub for the connected-inbox count. Reports a fixed count and records whether
/// the paywall actually invoked it, so tests can assert the db is only queried
/// when it should be.
struct InboxCountSpy {
    connected_inbox_count: i64,
    called: Cell<bool>,
}

impl InboxCountSpy {
    fn returning(connected_inbox_count: i64) -> Self {
        Self {
            connected_inbox_count,
            called: Cell::new(false),
        }
    }

    async fn count(&self) -> anyhow::Result<i64> {
        self.called.set(true);
        Ok(self.connected_inbox_count)
    }

    fn was_called(&self) -> bool {
        self.called.get()
    }
}

#[tokio::test]
async fn paywalls_inbox_at_free_limit_without_professional_features() {
    let inboxes = InboxCountSpy::returning(FREE_INBOX_LIMIT);

    let result = enforce_inbox_paywall(false, || inboxes.count()).await;

    assert!(
        inboxes.was_called(),
        "non-professional users should be checked for connected inbox count"
    );
    assert!(matches!(result, Err(InitGmailLinkError::PaymentRequired)));
}

#[tokio::test]
async fn first_inbox_is_free_without_professional_features() {
    let inboxes = InboxCountSpy::returning(0);

    let result = enforce_inbox_paywall(false, || inboxes.count()).await;

    assert!(
        inboxes.was_called(),
        "non-professional users should be checked for connected inbox count"
    );
    assert!(result.is_ok());
}

#[tokio::test]
async fn second_inbox_is_free_without_professional_features() {
    let inboxes = InboxCountSpy::returning(FREE_INBOX_LIMIT - 1);

    let result = enforce_inbox_paywall(false, || inboxes.count()).await;

    assert!(
        inboxes.was_called(),
        "non-professional users should be checked for connected inbox count"
    );
    assert!(result.is_ok());
}

#[tokio::test]
async fn professional_features_skip_existing_inbox_check() {
    let inboxes = InboxCountSpy::returning(FREE_INBOX_LIMIT);

    let result = enforce_inbox_paywall(true, || inboxes.count()).await;

    assert!(
        !inboxes.was_called(),
        "professional users should never trigger the connected-inbox count"
    );
    assert!(result.is_ok());
}

fn contains_scope(scopes: &str, scope: &str) -> bool {
    scopes.split_ascii_whitespace().any(|value| value == scope)
}

fn has_calendar(scopes: &str) -> bool {
    calendar_events::domain::models::GOOGLE_CALENDAR_SCOPES
        .iter()
        .all(|scope| contains_scope(scopes, scope))
}

fn has_mailbox(scopes: &str) -> bool {
    GMAIL_SCOPES
        .split_ascii_whitespace()
        .all(|scope| contains_scope(scopes, scope))
}

#[test]
fn calendar_scopes_require_both_the_kill_switch_and_an_asking_caller() {
    assert!(has_calendar(&gmail_authorization_scopes(
        true,
        ConsentScopes::Calendar
    )));
    assert!(has_calendar(&gmail_authorization_scopes(
        true,
        ConsentScopes::GmailAndCalendar
    )));
    assert!(!has_calendar(&gmail_authorization_scopes(
        true,
        ConsentScopes::Gmail
    )));

    for asking in [ConsentScopes::Calendar, ConsentScopes::GmailAndCalendar] {
        assert!(
            !has_calendar(&gmail_authorization_scopes(false, asking)),
            "the kill switch must veto calendar for {asking:?}"
        );
    }
}

#[test]
fn a_calendar_upgrade_asks_for_calendar_alone() {
    let scopes = gmail_authorization_scopes(true, ConsentScopes::Calendar);

    assert!(
        !has_mailbox(&scopes),
        "an inbox that is already connected must not re-consent to mailbox access"
    );
    for identity_scope in IDENTITY_SCOPES.split_ascii_whitespace() {
        assert!(
            contains_scope(&scopes, identity_scope),
            "{identity_scope} is required for the callback to identify the account"
        );
    }
}

#[test]
fn every_other_consent_keeps_the_mailbox_scopes() {
    for (calendar_scope_enabled, asking) in [
        (true, ConsentScopes::Gmail),
        (true, ConsentScopes::GmailAndCalendar),
        (false, ConsentScopes::Gmail),
        (false, ConsentScopes::GmailAndCalendar),
        // A vetoed calendar upgrade falls back to the mailbox consent.
        (false, ConsentScopes::Calendar),
    ] {
        assert!(
            has_mailbox(&gmail_authorization_scopes(calendar_scope_enabled, asking)),
            "mailbox scopes must be requested for {asking:?} (calendar enabled: {calendar_scope_enabled})"
        );
    }
}

#[test]
fn authorization_url_requests_incremental_calendar_access() {
    let scopes = gmail_authorization_scopes(true, ConsentScopes::Calendar);
    let url = google_authorization_url(
        "client-id",
        "https://auth.example.com/oauth2/callback",
        &scopes,
        "state",
    )
    .unwrap();
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();

    assert_eq!(
        params
            .get("include_granted_scopes")
            .map(|value| value.as_ref()),
        Some("true")
    );
    assert_eq!(
        params.get("access_type").map(|value| value.as_ref()),
        Some("offline")
    );
    assert_eq!(
        params.get("prompt").map(|value| value.as_ref()),
        Some("consent")
    );
    let granted = params.get("scope").unwrap();
    for calendar_scope in calendar_events::domain::models::GOOGLE_CALENDAR_SCOPES {
        assert!(
            granted
                .split_ascii_whitespace()
                .any(|scope| scope == calendar_scope)
        );
    }
}
