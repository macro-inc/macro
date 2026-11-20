use super::*;

#[test]
fn a_missing_limit_and_snippet_length_ask_for_the_defaults() {
    let (user, read) = parse_request(
        "macro|owner@example.com".to_owned(),
        RecentMessagesQuery::default(),
    )
    .unwrap();

    assert_eq!(user.as_ref(), "macro|owner@example.com");
    assert_eq!(
        read,
        Read::Newest {
            limit: DEFAULT_RECENT_MESSAGES,
            snippet_chars: DEFAULT_SNIPPET_CHARS,
        }
    );
}

#[test]
fn a_given_limit_is_passed_on() {
    let (_, read) = parse_request(
        "macro|owner@example.com".to_owned(),
        RecentMessagesQuery {
            limit: Some(5),
            snippet_chars: Some(500),
            ..RecentMessagesQuery::default()
        },
    )
    .unwrap();

    assert_eq!(
        read,
        Read::Newest {
            limit: 5,
            snippet_chars: 500,
        }
    );
}

#[test]
fn days_ask_for_a_window_with_text_on_the_newest() {
    let (_, read) = parse_request(
        "macro|owner@example.com".to_owned(),
        RecentMessagesQuery {
            limit: Some(500),
            snippet_chars: Some(300),
            days: Some(30),
            texts: Some(100),
        },
    )
    .unwrap();

    assert_eq!(
        read,
        Read::Window(WindowRead {
            days: 30,
            limit: 500,
            texts: 100,
            snippet_chars: 300,
        })
    );

    // Without `texts`, every message carries its snippet.
    let (_, read) = parse_request(
        "macro|owner@example.com".to_owned(),
        RecentMessagesQuery {
            days: Some(7),
            ..RecentMessagesQuery::default()
        },
    )
    .unwrap();

    assert_eq!(
        read,
        Read::Window(WindowRead {
            days: 7,
            limit: DEFAULT_RECENT_MESSAGES,
            texts: DEFAULT_RECENT_MESSAGES,
            snippet_chars: DEFAULT_SNIPPET_CHARS,
        })
    );
}

#[test]
fn an_invalid_user_id_is_a_400() {
    let error = parse_request("not a user".to_owned(), RecentMessagesQuery::default()).unwrap_err();

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
