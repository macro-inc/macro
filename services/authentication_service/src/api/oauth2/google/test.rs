use axum::http::header::LOCATION;
use reqwest::StatusCode;
use url::Url;
use uuid::Uuid;

use super::{
    PartialGrantDisposition, mailbox_grant_missing, mailbox_not_granted_response,
    partial_grant_disposition, resolved_granted_scopes,
};

const GMAIL: &str = "https://www.googleapis.com/auth/gmail.modify";
const CALENDAR: &str = "https://www.googleapis.com/auth/calendar.events";

#[test]
fn uses_requested_scopes_when_google_omits_an_unchanged_scope_field() {
    let requested = vec![GMAIL.to_string(), CALENDAR.to_string()];

    assert_eq!(resolved_granted_scopes("", requested.clone()), requested);
}

#[test]
fn uses_google_scope_field_when_the_grant_differs_from_the_request() {
    let requested = vec!["requested".to_string()];

    assert_eq!(
        resolved_granted_scopes("calendar gmail", requested),
        vec!["calendar".to_string(), "gmail".to_string()]
    );
}

#[test]
fn a_consent_that_asked_for_the_mailbox_must_grant_it() {
    let requested = vec![GMAIL.to_string(), CALENDAR.to_string()];

    assert!(mailbox_grant_missing(&requested, &[CALENDAR.to_string()]));
    assert!(mailbox_grant_missing(&requested, &[]));
    assert!(!mailbox_grant_missing(
        &requested,
        &[CALENDAR.to_string(), GMAIL.to_string()]
    ));
    assert!(
        !mailbox_grant_missing(&[CALENDAR.to_string()], &[CALENDAR.to_string()]),
        "a calendar upgrade never asks for the mailbox"
    );
}

#[test]
fn a_refused_consent_returns_to_the_app_with_the_error() {
    let link_id = Uuid::parse_str("0192b8a0-6a2e-7c3e-9b1f-4d5e6f708192").unwrap();

    let response = mailbox_not_granted_response(
        Some("https://macro.com/app/inbox-link-callback?view=all&email_link_error=cancelled"),
        &link_id,
    );

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let location = response.headers()[LOCATION].to_str().unwrap().to_owned();
    let query: Vec<(String, String)> = Url::parse(&location)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect();
    assert_eq!(
        query,
        vec![
            ("view".into(), "all".into()),
            ("link_id".into(), link_id.to_string()),
            ("email_link_error".into(), "gmail_not_granted".into()),
            ("provider".into(), "gmail".into()),
        ]
    );
}

#[test]
fn a_refused_consent_without_a_return_url_keeps_the_error_body() {
    let response = mailbox_not_granted_response(None, &Uuid::now_v7());

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn a_refused_grant_is_revoked_when_no_inbox_works_on_it() {
    assert_eq!(
        partial_grant_disposition(None),
        PartialGrantDisposition::Revoke,
        "an account with no inbox loses nothing"
    );
    assert_eq!(
        partial_grant_disposition(Some(true)),
        PartialGrantDisposition::Revoke,
        "an inbox whose grant already stopped yielding tokens loses nothing"
    );
}

#[test]
fn a_refused_grant_keeps_a_working_inbox_grant() {
    assert_eq!(
        partial_grant_disposition(Some(false)),
        PartialGrantDisposition::Keep,
        "revoking would take the whole grant, and with it the inbox's mail and calendar sync"
    );
}
