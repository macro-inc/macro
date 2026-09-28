use super::*;

/// The harness advertises `Authorization: Bearer <session token>`; rmcp wants
/// the bare token and adds the scheme itself.
#[test]
fn a_bearer_authorization_header_becomes_the_bare_token() {
    assert_eq!(
        place_header("Authorization", "Bearer session-token"),
        Some(HeaderPlacement::BearerToken("session-token".to_owned()))
    );
    assert_eq!(
        place_header("authorization", "bearer  spaced-token "),
        Some(HeaderPlacement::BearerToken("spaced-token".to_owned()))
    );
}

#[test]
fn other_headers_are_sent_verbatim() {
    assert_eq!(
        place_header("X-Custom", "value"),
        Some(HeaderPlacement::Custom(
            HeaderName::from_static("x-custom"),
            HeaderValue::from_static("value"),
        ))
    );
    // A non-bearer authorization scheme is not something to strip.
    assert_eq!(
        place_header("Authorization", "Basic abc"),
        Some(HeaderPlacement::Custom(
            AUTHORIZATION,
            HeaderValue::from_static("Basic abc"),
        ))
    );
}

#[test]
fn invalid_headers_are_dropped() {
    assert_eq!(place_header("not a header", "x"), None);
    assert_eq!(place_header("X-Custom", "line\nbreak"), None);
}
