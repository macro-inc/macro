use super::*;

#[test]
fn a_missing_limit_and_snippet_length_ask_for_the_defaults() {
    let (user, limit, snippet_chars) = parse_request(
        "macro|owner@example.com".to_owned(),
        RecentMessagesQuery {
            limit: None,
            snippet_chars: None,
        },
    )
    .unwrap();

    assert_eq!(user.as_ref(), "macro|owner@example.com");
    assert_eq!(limit, DEFAULT_RECENT_MESSAGES);
    assert_eq!(snippet_chars, DEFAULT_SNIPPET_CHARS);
}

#[test]
fn a_given_limit_is_passed_on() {
    let (_, limit, snippet_chars) = parse_request(
        "macro|owner@example.com".to_owned(),
        RecentMessagesQuery {
            limit: Some(5),
            snippet_chars: Some(500),
        },
    )
    .unwrap();

    assert_eq!(limit, 5);
    assert_eq!(snippet_chars, 500);
}

#[test]
fn an_invalid_user_id_is_a_400() {
    let error = parse_request(
        "not a user".to_owned(),
        RecentMessagesQuery {
            limit: None,
            snippet_chars: None,
        },
    )
    .unwrap_err();

    assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
}

#[test]
fn an_inbox_lookup_failure_is_a_500() {
    let error = RecentMessagesError::from(MailboxError::Persistence);

    assert_eq!(
        error.into_response().status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
}
