use axum::http::HeaderValue;

use super::*;

const PERM_SECRET: &str = "perm-secret";
const INTERNAL_KEY: &str = "internal-key";

fn authenticator() -> Authenticator {
    Authenticator::new(Secrets::new(
        INTERNAL_KEY.to_string(),
        PERM_SECRET.to_string(),
    ))
}

fn bearer(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header_names::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
    );
    headers
}

fn jwt(document_id: &str, access_level: &str) -> String {
    let claims = serde_json::json!({
        "user_id": null,
        "document_id": document_id,
        "access_level": access_level,
        // decoding validates `exp` by default; set it far in the future.
        "exp": 4_102_444_800u64,
    });
    macro_sync_service_jwt::encode(&claims, PERM_SECRET)
        .unwrap()
        .into_inner()
}

#[test]
fn internal_key_authenticates_as_admin() {
    let headers = {
        let mut h = HeaderMap::new();
        h.insert(
            header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
            HeaderValue::from_static(INTERNAL_KEY),
        );
        h
    };
    assert!(authenticator().authorize(&headers, &DocumentId::from("any-doc"), AccessLevel::Admin,));
}

#[test]
fn wrong_internal_key_is_unauthorized() {
    let headers = {
        let mut h = HeaderMap::new();
        h.insert(
            header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
            HeaderValue::from_static("not-the-key"),
        );
        h
    };
    assert!(!authenticator().authorize(&headers, &DocumentId::from("any-doc"), AccessLevel::View,));
}

#[test]
fn valid_token_grants_up_to_its_level() {
    let headers = bearer(&jwt("doc-1", "edit"));
    let auth = authenticator();
    assert!(auth.authorize(&headers, &DocumentId::from("doc-1"), AccessLevel::View));
    assert!(auth.authorize(&headers, &DocumentId::from("doc-1"), AccessLevel::Edit));
}

#[test]
fn view_token_rejected_for_higher_level() {
    let headers = bearer(&jwt("doc-1", "view"));
    assert!(!authenticator().authorize(&headers, &DocumentId::from("doc-1"), AccessLevel::Admin,));
}

#[test]
fn token_rejected_for_other_document() {
    let headers = bearer(&jwt("doc-1", "edit"));
    assert!(!authenticator().authorize(&headers, &DocumentId::from("doc-2"), AccessLevel::View,));
}

#[test]
fn missing_token_is_unauthorized() {
    assert!(!authenticator().authorize(
        &HeaderMap::new(),
        &DocumentId::from("doc-1"),
        AccessLevel::View,
    ));
}
