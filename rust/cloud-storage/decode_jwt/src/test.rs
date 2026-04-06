use std::collections::HashMap;

use super::*;

/// Confirm that axum's `Query<Params>` (which uses `serde_urlencoded`) decodes
/// percent-encoded values the same way the old `url::form_urlencoded::parse` did.
#[test]
fn query_extractor_decodes_percent_encoded_token() {
    let token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc";
    let encoded = format!("macro-api-token={}", urlencoding::encode(token));

    let params: Params = serde_urlencoded::from_str(&encoded).unwrap();
    assert_eq!(params.macro_api_token.as_deref(), Some(token));
}

/// The old code collected into a `HashMap<String, String>` via
/// `url::form_urlencoded::parse`. Confirm `serde_urlencoded` produces the same
/// result for a realistic JWT value that contains dots (which are not special in
/// percent-encoding but are worth checking).
#[test]
fn query_extractor_matches_form_urlencoded_parse() {
    let token = "header.payload.signature";
    let query = format!("macro-api-token={token}&other=value");

    // Old approach
    let old: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();

    // New approach
    let new: Params = serde_urlencoded::from_str(&query).unwrap();

    assert_eq!(
        old.get("macro-api-token").unwrap(),
        new.macro_api_token.as_ref().unwrap()
    );
}

/// Percent-encoded special characters (e.g. `%2B` for `+`) must be decoded.
#[test]
fn query_extractor_decodes_special_characters() {
    let query = "macro-api-token=a%2Bb%3Dc";

    let old: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();

    let new: Params = serde_urlencoded::from_str(query).unwrap();

    assert_eq!(old.get("macro-api-token").unwrap(), "a+b=c");
    assert_eq!(new.macro_api_token.as_deref(), Some("a+b=c"));
}
