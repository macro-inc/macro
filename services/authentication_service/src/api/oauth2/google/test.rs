use super::resolved_granted_scopes;

#[test]
fn uses_requested_scopes_when_google_omits_an_unchanged_scope_field() {
    let requested = vec![
        "https://www.googleapis.com/auth/gmail.modify".to_string(),
        "https://www.googleapis.com/auth/calendar.events".to_string(),
    ];

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
