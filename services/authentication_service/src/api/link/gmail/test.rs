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

#[test]
fn authorization_url_requests_incremental_calendar_access() {
    let scopes = format!("{GMAIL_SCOPES} {}", google_calendar_scope_parameter());
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
