use super::*;

#[test]
fn titles_are_fitted_to_the_meeting_contract() {
    assert_eq!(
        meeting_title("  Design review "),
        Some("Design review".to_string())
    );
    assert_eq!(meeting_title(""), None);
    assert_eq!(meeting_title("   "), None);
    assert_eq!(
        meeting_title("Line one\nline two"),
        Some("Line one line two".to_string())
    );
    let long = "x".repeat(MAX_MEETING_TITLE_CHARS + 50);
    assert_eq!(
        meeting_title(&long).map(|title| title.chars().count()),
        Some(MAX_MEETING_TITLE_CHARS)
    );
}

#[test]
fn join_links_use_the_setup_route_the_frontend_recognizes() {
    let token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    assert_eq!(
        join_url("https://macro.com", token),
        format!("https://macro.com/app/meet/join/{token}")
    );
    assert_eq!(
        join_url("http://localhost:3000".trim_end_matches('/'), token),
        format!("http://localhost:3000/app/meet/join/{token}")
    );
}

#[test]
fn provider_validation_failures_surface_as_invalid_input() {
    assert!(matches!(
        map_call_error(CallError::InvalidRequest("bad".to_string())),
        MeetingLinkError::InvalidInput(message) if message == "bad"
    ));
    assert!(matches!(
        map_call_error(CallError::Auth),
        MeetingLinkError::Failed(_)
    ));
}

#[test]
fn requester_ids_must_be_macro_user_ids() {
    assert!(requester("macro|owner@example.com").is_ok());
    assert!(matches!(
        requester("not a user id"),
        Err(MeetingLinkError::InvalidInput(_))
    ));
}
