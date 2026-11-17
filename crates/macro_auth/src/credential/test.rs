use super::*;
use axum::http::Request;

/// What a request to `uri` with `headers` carries.
fn credential(uri: &str, headers: &[(&str, &str)]) -> Result<RequestCredential, CredentialError> {
    let mut request = Request::builder().uri(uri);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let (mut parts, ()) = request.body(()).unwrap().into_parts();
    request_credential(&mut parts)
}

fn kind(uri: &str, headers: &[(&str, &str)]) -> Result<CredentialKind, CredentialError> {
    credential(uri, headers).map(|credential| credential.kind)
}

fn cookie(token: &str) -> String {
    format!("{}={token}", access_token_cookie_name())
}

fn user(token: &str, source: TokenSource) -> Result<CredentialKind, CredentialError> {
    Ok(CredentialKind::UserToken {
        token: token.to_owned(),
        source,
    })
}

#[test]
fn a_request_authenticates_with_its_first_user_token_by_source() {
    assert_eq!(kind("/x", &[]), Ok(CredentialKind::None));
    assert_eq!(
        kind("/x", &[("authorization", "Bearer one")]),
        user("one", TokenSource::Bearer)
    );
    assert_eq!(
        kind("/x", &[("authorization", "bearer one")]),
        user("one", TokenSource::Bearer)
    );
    assert_eq!(
        kind("/x?macro-api-token=one", &[]),
        user("one", TokenSource::Query)
    );
    assert_eq!(
        kind("/x", &[("cookie", &cookie("one"))]),
        user("one", TokenSource::Cookie)
    );
    // A percent-encoded key is the same key, and so is an encoded cookie.
    assert_eq!(
        kind("/x?macro%2Dapi%2Dtoken=one", &[]),
        user("one", TokenSource::Query)
    );
    let encoded_cookie = format!("{}=o%6Ee", access_token_cookie_name().replace('-', "%2D"));
    assert_eq!(
        kind("/x", &[("cookie", &encoded_cookie)]),
        user("one", TokenSource::Cookie)
    );
    // Keys are compared exactly once decoded: another case is another key.
    assert_eq!(
        kind("/x?Macro-Api-Token=one", &[]),
        Ok(CredentialKind::None)
    );
    // Query, then bearer, then cookie.
    let all = [
        ("authorization", "Bearer two"),
        ("cookie", &cookie("three") as &str),
    ];
    assert_eq!(
        kind("/x?macro-api-token=one", &all),
        user("one", TokenSource::Query)
    );
    assert_eq!(kind("/x", &all), user("two", TokenSource::Bearer));
}

/// Every user token is named, wherever it travels, so the scope check sees
/// a scoped one however many others ride beside it.
#[test]
fn every_user_token_in_the_request_is_named() {
    let carried = credential(
        "/x?macro%2Dapi%2Dtoken=junk&macro-api-token=one",
        &[
            ("authorization", "Bearer two"),
            ("cookie", &format!("{}; other=x", cookie("scoped"))),
            ("cookie", &cookie("one")),
        ],
    )
    .unwrap();
    assert_eq!(
        carried.kind,
        CredentialKind::UserToken {
            token: "junk".to_owned(),
            source: TokenSource::Query,
        }
    );
    assert_eq!(carried.user_tokens, ["junk", "one", "scoped", "two"]);
}

/// An ambient cookie never competes with an explicit credential of another
/// kind; explicit credentials of different kinds, or one header with
/// different values, are refused.
#[test]
fn explicit_credentials_of_different_kinds_are_refused() {
    let scoped_cookie = cookie("scoped");
    let with_cookie = credential(
        "/x",
        &[(BOT_TOKEN_HEADER, "bot"), ("cookie", &scoped_cookie)],
    )
    .unwrap();
    assert_eq!(with_cookie.kind, CredentialKind::Bot);
    assert_eq!(with_cookie.user_tokens, ["scoped"]);
    assert_eq!(
        kind(
            "/x",
            &[(USER_API_KEY_HEADER, "key"), ("cookie", &scoped_cookie)]
        ),
        Ok(CredentialKind::UserApiKey)
    );
    assert_eq!(
        kind(
            "/x",
            &[
                (INTERNAL_API_KEY_HEADER, "key"),
                (LEGACY_DSS_INTERNAL_API_KEY_HEADER, "key")
            ]
        ),
        Ok(CredentialKind::Internal)
    );
    assert_eq!(
        kind(
            "/x",
            &[("authorization", "Basic abc"), ("cookie", &scoped_cookie)]
        ),
        Ok(CredentialKind::MalformedAuthorization)
    );
    for (uri, headers) in [
        ("/x?macro-api-token=one", vec![(USER_API_KEY_HEADER, "key")]),
        (
            "/x",
            vec![("authorization", "Bearer one"), (BOT_TOKEN_HEADER, "bot")],
        ),
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
        (
            "/x",
            vec![("authorization", "Basic abc"), (BOT_TOKEN_HEADER, "bot")],
        ),
    ] {
        assert_eq!(
            kind(uri, &headers),
            Err(CredentialError::Conflicting),
            "{uri} {headers:?}"
        );
    }
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
    assert_eq!(
        request_credential(&mut parts).unwrap().kind,
        user("one", TokenSource::Bearer).unwrap()
    );
    parts
        .headers
        .insert("authorization", "Bearer two".parse().unwrap());
    assert_eq!(
        request_credential(&mut parts).unwrap().kind,
        user("one", TokenSource::Bearer).unwrap()
    );
}
