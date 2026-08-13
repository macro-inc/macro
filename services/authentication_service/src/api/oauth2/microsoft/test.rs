use fusionauth::microsoft::oauth::MicrosoftUserInfo;
use reqwest::StatusCode;
use uuid::Uuid;

use super::{extract_identity, require_link_id, verify_identity_provider};
use crate::api::oauth2::OAuthState;

fn state(identity_provider_id: &str, link_id: Option<Uuid>) -> OAuthState {
    OAuthState {
        identity_provider_id: identity_provider_id.to_string(),
        link_id,
        original_url: None,
        is_mobile: None,
    }
}

#[test]
fn extracts_subject_and_normalizes_email() {
    let identity = extract_identity(MicrosoftUserInfo {
        sub: "microsoft-user-id".into(),
        email: "Linked.User+Macro@Example.COM".into(),
    })
    .unwrap();

    assert_eq!(identity.subject, "microsoft-user-id");
    assert_eq!(identity.email, "linked.user@example.com");
}

#[test]
fn rejects_identity_without_subject_or_usable_email() {
    for user_info in [
        MicrosoftUserInfo {
            sub: "".into(),
            email: "linked@example.com".into(),
        },
        MicrosoftUserInfo {
            sub: "microsoft-user-id".into(),
            email: "not-an-email".into(),
        },
    ] {
        assert!(extract_identity(user_info).is_err());
    }
}

#[test]
fn microsoft_callback_requires_link_id() {
    let error = require_link_id(&state("microsoft-idp-id", None)).unwrap_err();

    assert_eq!(error.0, StatusCode::BAD_REQUEST);
    assert!(error.1.contains("link_id"));
}

#[test]
fn microsoft_callback_rejects_identity_provider_mismatch() {
    let callback_state = state("unexpected-idp-id", Some(Uuid::now_v7()));
    let error = verify_identity_provider(&callback_state, "microsoft-idp-id").unwrap_err();

    assert_eq!(error.0, StatusCode::BAD_REQUEST);
}

#[test]
fn microsoft_callback_accepts_resolved_identity_provider() {
    let callback_state = state("microsoft-idp-id", Some(Uuid::now_v7()));

    verify_identity_provider(&callback_state, "microsoft-idp-id").unwrap();
}
