use super::*;

#[test]
fn a_missing_limit_asks_for_the_most_messages() {
    let (user, limit) = parse_request(
        "macro|owner@example.com".to_owned(),
        RecentMessagesQuery { limit: None },
    )
    .unwrap();

    assert_eq!(user.as_ref(), "macro|owner@example.com");
    assert_eq!(limit, MAX_RECENT_MESSAGES);
}

#[test]
fn a_given_limit_is_passed_on() {
    let (_, limit) = parse_request(
        "macro|owner@example.com".to_owned(),
        RecentMessagesQuery { limit: Some(5) },
    )
    .unwrap();

    assert_eq!(limit, 5);
}

#[test]
fn an_invalid_user_id_is_a_400() {
    let error =
        parse_request("not a user".to_owned(), RecentMessagesQuery { limit: None }).unwrap_err();

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
