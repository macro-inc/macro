use super::*;

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
