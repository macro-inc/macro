use super::*;

const SECRET: &str = "a distinct account-link state test secret";
const NOW: i64 = 1_730_000_000;

fn key() -> AccountLinkStateKey {
    AccountLinkStateKey::new(SECRET).unwrap()
}

fn link_id() -> Uuid {
    Uuid::parse_str("0192b8a0-6a2e-7c3e-9b1f-4d5e6f708192").unwrap()
}

fn fusion_user_id() -> Uuid {
    Uuid::parse_str("8c06ab3e-693c-45a7-8f92-1b5a5bf876ac").unwrap()
}

fn state(original_url: Option<&str>, exp: i64) -> AccountLinkState {
    AccountLinkState {
        provider: LinkProvider::Google,
        identity_provider_id: "google-gmail-idp".into(),
        link_id: link_id(),
        fusion_user_id: fusion_user_id(),
        original_url: original_url.map(str::to_owned),
        exp,
    }
}

fn sign_raw_payload(payload: &[u8]) -> String {
    let encoded_payload = URL_SAFE_NO_PAD.encode(payload);
    let signature = signature_for(encoded_payload.as_bytes(), &key());
    format!("{encoded_payload}.{}", URL_SAFE_NO_PAD.encode(signature))
}

fn payload_json(token: &str) -> String {
    let encoded_payload = token.split_once('.').unwrap().0;
    String::from_utf8(URL_SAFE_NO_PAD.decode(encoded_payload).unwrap()).unwrap()
}

#[test]
fn payload_round_trips_deterministically() {
    let payload = state(
        Some("https://macro.com/app/inbox-link-callback"),
        NOW + 3_600,
    );

    let first_token = sign_account_link_state(&payload, &key()).unwrap();
    let second_token = sign_account_link_state(&payload, &key()).unwrap();

    assert_eq!(first_token, second_token);
    assert!(!first_token.contains('='));
    assert_eq!(
        verify_account_link_state(&first_token, &key(), NOW).unwrap(),
        payload
    );
}

#[test]
fn payload_without_original_url_omits_the_field() {
    let payload = state(None, NOW + 3_600);
    let token = sign_account_link_state(&payload, &key()).unwrap();

    assert!(!payload_json(&token).contains("original_url"));
    assert_eq!(
        verify_account_link_state(&token, &key(), NOW).unwrap(),
        payload
    );
}

#[test]
fn provider_serializes_as_the_callback_path_segment() {
    for (provider, segment) in [
        (LinkProvider::Google, "google"),
        (LinkProvider::Github, "github"),
        (LinkProvider::Microsoft, "microsoft"),
    ] {
        assert_eq!(provider.as_str(), segment);
        assert_eq!(provider.to_string(), segment);
        assert_eq!(
            serde_json::to_string(&provider).unwrap(),
            format!("\"{segment}\"")
        );
    }
}

#[test]
fn new_state_expires_one_ttl_from_now() {
    let before = chrono::Utc::now().timestamp();
    let state = AccountLinkState::new(
        LinkProvider::Github,
        "github-idp".into(),
        link_id(),
        fusion_user_id(),
        None,
    );
    let after = chrono::Utc::now().timestamp();
    let ttl = ACCOUNT_LINK_STATE_TTL.num_seconds();

    assert!(state.exp >= before + ttl);
    assert!(state.exp <= after + ttl);
    assert!(
        verify_account_link_state(
            &sign_account_link_state(&state, &key()).unwrap(),
            &key(),
            after
        )
        .is_ok()
    );
}

#[test]
fn expiration_boundary_is_enforced_and_names_the_pending_link() {
    let token = sign_account_link_state(&state(None, NOW), &key()).unwrap();

    assert_eq!(
        verify_account_link_state(&token, &key(), NOW - 1),
        Ok(state(None, NOW))
    );
    for current_timestamp in [NOW, NOW + 1] {
        assert_eq!(
            verify_account_link_state(&token, &key(), current_timestamp),
            Err(AccountLinkStateError::Expired { link_id: link_id() })
        );
    }
}

#[test]
fn malformed_tokens_are_rejected() {
    for token in [
        "",
        "payload",
        ".signature",
        "payload.",
        "payload.signature.extra",
        "%%%.signature",
        "payload.%%%",
        r#"{"identity_provider_id":"idp","link_id":"0192b8a0-6a2e-7c3e-9b1f-4d5e6f708192"}"#,
    ] {
        assert!(
            verify_account_link_state(token, &key(), NOW).is_err(),
            "token should be rejected: {token}"
        );
    }

    let malformed_json = sign_raw_payload(b"not json");
    assert_eq!(
        verify_account_link_state(&malformed_json, &key(), NOW),
        Err(AccountLinkStateError::Malformed)
    );
}

#[test]
fn authentic_payloads_with_bad_fields_are_rejected() {
    let base = serde_json::json!({
        "provider": "google",
        "identity_provider_id": "google-gmail-idp",
        "link_id": link_id(),
        "fusion_user_id": fusion_user_id(),
        "exp": NOW + 3_600,
    });

    for (field, value) in [
        ("provider", serde_json::json!("apple")),
        ("link_id", serde_json::json!("not-a-uuid")),
        ("fusion_user_id", serde_json::json!("not-a-uuid")),
        ("exp", serde_json::json!("soon")),
    ] {
        let mut payload = base.clone();
        payload[field] = value;
        let token = sign_raw_payload(&serde_json::to_vec(&payload).unwrap());
        assert_eq!(
            verify_account_link_state(&token, &key(), NOW),
            Err(AccountLinkStateError::Malformed),
            "{field} should be validated"
        );
    }

    for field in ["provider", "link_id", "fusion_user_id", "exp"] {
        let mut payload = base.clone();
        payload.as_object_mut().unwrap().remove(field);
        let token = sign_raw_payload(&serde_json::to_vec(&payload).unwrap());
        assert_eq!(
            verify_account_link_state(&token, &key(), NOW),
            Err(AccountLinkStateError::Malformed),
            "{field} should be required"
        );
    }
}

#[test]
fn payload_tampering_is_rejected() {
    let token = sign_account_link_state(&state(None, NOW + 3_600), &key()).unwrap();
    let (encoded_payload, encoded_signature) = token.split_once('.').unwrap();
    let mut json: serde_json::Value =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded_payload).unwrap()).unwrap();

    for (field, value) in [
        ("link_id", serde_json::json!(Uuid::now_v7())),
        ("fusion_user_id", serde_json::json!(Uuid::now_v7())),
        (
            "original_url",
            serde_json::json!("https://evil.example.com/"),
        ),
        ("provider", serde_json::json!("github")),
        ("exp", serde_json::json!(NOW + 7_200)),
    ] {
        json[field] = value;
        let tampered_payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json).unwrap());
        let tampered_token = format!("{tampered_payload}.{encoded_signature}");

        assert_eq!(
            verify_account_link_state(&tampered_token, &key(), NOW),
            Err(AccountLinkStateError::InvalidSignature),
            "changing {field} should invalidate the signature"
        );
    }
}

#[test]
fn signature_tampering_and_wrong_keys_are_rejected() {
    let token = sign_account_link_state(&state(None, NOW + 3_600), &key()).unwrap();
    let (encoded_payload, encoded_signature) = token.split_once('.').unwrap();
    let mut signature = URL_SAFE_NO_PAD.decode(encoded_signature).unwrap();
    signature[0] ^= 1;
    let tampered_token = format!("{encoded_payload}.{}", URL_SAFE_NO_PAD.encode(signature));
    let other_key = AccountLinkStateKey::new("another secret that is also long enough").unwrap();

    assert_eq!(
        verify_account_link_state(&tampered_token, &key(), NOW),
        Err(AccountLinkStateError::InvalidSignature)
    );
    assert_eq!(
        verify_account_link_state(&token, &other_key, NOW),
        Err(AccountLinkStateError::InvalidSignature)
    );
}

#[test]
fn keys_must_be_at_least_32_bytes() {
    for secret in ["", "   ", "short", &"x".repeat(MIN_SECRET_LENGTH - 1)] {
        let error = AccountLinkStateKey::new(secret).expect_err("short keys are rejected");
        assert!(error.to_string().contains("ACCOUNT_LINK_STATE_SECRET"));
        assert!(!error.to_string().contains(secret.trim()) || secret.trim().is_empty());
    }

    assert!(AccountLinkStateKey::new(&"x".repeat(MIN_SECRET_LENGTH)).is_ok());
    assert!(AccountLinkStateKey::new(&format!("  {}  ", "x".repeat(MIN_SECRET_LENGTH))).is_ok());
}

#[test]
fn key_debug_output_redacts_the_secret() {
    let debug = format!("{:?}", key());

    assert!(!debug.contains(SECRET));
    assert!(debug.contains("redacted"));
}
