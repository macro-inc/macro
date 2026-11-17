use super::*;
use axum::http::Request;

/// The credential of a request to `uri` with `headers`.
fn credential(
    uri: &str,
    headers: &[(&str, &str)],
) -> Result<RequestCredential, ConflictingCredentials> {
    let mut request = Request::builder().uri(uri);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let (mut parts, ()) = request.body(()).unwrap().into_parts();
    request_credential(&mut parts)
}

fn cookie(token: &str) -> String {
    format!("{}={token}", access_token_cookie_name())
}

fn user(token: &str, explicit: bool) -> Result<RequestCredential, ConflictingCredentials> {
    Ok(RequestCredential::UserToken {
        token: token.to_owned(),
        explicit,
    })
}

#[test]
fn a_request_carries_its_one_user_token_from_any_source() {
    assert_eq!(credential("/x", &[]), Ok(RequestCredential::None));
    assert_eq!(
        credential("/x", &[("authorization", "Bearer one")]),
        user("one", true)
    );
    assert_eq!(
        credential("/x", &[("authorization", "bearer one")]),
        user("one", true)
    );
    assert_eq!(credential("/x?macro-api-token=one", &[]), user("one", true));
    assert_eq!(
        credential("/x", &[("cookie", &cookie("one"))]),
        user("one", false)
    );
    // A percent-encoded key is the same key.
    assert_eq!(
        credential("/x?macro%2Dapi%2Dtoken=one", &[]),
        user("one", true)
    );
    // Keys are compared exactly once decoded: another case is another key.
    assert_eq!(
        credential("/x?Macro-Api-Token=one", &[]),
        Ok(RequestCredential::None)
    );
}

#[test]
fn the_same_token_in_several_places_is_one_credential() {
    let both = [("authorization", "Bearer one"), ("cookie", &cookie("one"))];
    assert_eq!(credential("/x", &both), user("one", true));
    assert_eq!(
        credential("/x?macro-api-token=one&macro-api-token=one", &both),
        user("one", true)
    );
}

#[test]
fn differing_credentials_are_refused() {
    let scoped_cookie = cookie("scoped");
    for (uri, headers) in [
        // An encoded query key with a different ambient cookie.
        (
            "/x?macro%2Dapi%2Dtoken=junk",
            vec![("cookie", scoped_cookie.as_str())],
        ),
        // Two query parameters with different values.
        ("/x?macro-api-token=one&macro-api-token=two", vec![]),
        ("/x?macro-api-token=one&macro%2dapi%2dtoken=two", vec![]),
        // A query token with a different bearer.
        (
            "/x?macro-api-token=one",
            vec![("authorization", "Bearer two")],
        ),
        // A bearer with a different cookie.
        (
            "/x",
            vec![
                ("authorization", "Bearer one"),
                ("cookie", scoped_cookie.as_str()),
            ],
        ),
        // A user API key with a JWT.
        (
            "/x",
            vec![
                ("authorization", "Bearer one"),
                (USER_API_KEY_HEADER, "key"),
            ],
        ),
        (
            "/x",
            vec![
                (USER_API_KEY_HEADER, "key"),
                ("cookie", scoped_cookie.as_str()),
            ],
        ),
        // Two credential kinds, or one header twice with different values.
        (
            "/x",
            vec![(BOT_TOKEN_HEADER, "bot"), (HARNESS_TOKEN_HEADER, "harness")],
        ),
        (
            "/x",
            vec![(BOT_TOKEN_HEADER, "one"), (BOT_TOKEN_HEADER, "two")],
        ),
        (
            "/x",
            vec![
                (INTERNAL_API_KEY_HEADER, "one"),
                (LEGACY_DSS_INTERNAL_API_KEY_HEADER, "two"),
            ],
        ),
        // A non-bearer Authorization beside a token.
        (
            "/x",
            vec![
                ("authorization", "Basic abc"),
                ("cookie", scoped_cookie.as_str()),
            ],
        ),
    ] {
        assert_eq!(
            credential(uri, &headers),
            Err(ConflictingCredentials),
            "{uri} {headers:?}"
        );
    }
}

#[test]
fn other_credential_kinds_are_named_once() {
    assert_eq!(
        credential("/x", &[(BOT_TOKEN_HEADER, "bot")]),
        Ok(RequestCredential::Bot)
    );
    assert_eq!(
        credential(
            "/x",
            &[
                (INTERNAL_API_KEY_HEADER, "key"),
                (INTERNAL_API_KEY_HEADER, "key")
            ]
        ),
        Ok(RequestCredential::Internal)
    );
    assert_eq!(
        credential("/x", &[("authorization", "Basic abc")]),
        Ok(RequestCredential::MalformedAuthorization)
    );
}

/// Parsed once: a later reader gets the first reading, whatever happened to
/// the request in between.
#[test]
fn the_reading_is_kept_for_every_later_reader() {
    let (mut parts, ()) = Request::builder()
        .uri("/x")
        .header("authorization", "Bearer one")
        .body(())
        .unwrap()
        .into_parts();
    assert_eq!(request_credential(&mut parts), user("one", true));
    parts
        .headers
        .insert("authorization", "Bearer two".parse().unwrap());
    assert_eq!(request_credential(&mut parts), user("one", true));
}
