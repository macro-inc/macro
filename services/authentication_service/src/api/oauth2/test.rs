use super::*;

#[test]
fn callback_original_url_allows_trusted_destinations() {
    for original_url in [
        "macro://login",
        "tauri://localhost/app/login",
        "http://localhost/app/login",
        "https://dev.macro.com/app/login",
        "https://macro.com/app/login",
    ] {
        assert!(
            validate_original_url(Some(original_url)).is_ok(),
            "{original_url} should be allowed"
        );
    }
}

#[test]
fn callback_original_url_rejects_untrusted_destinations() {
    for original_url in [
        "https://evil.example.com/phish",
        "https://macro.com.example.com/phish",
        "http://macro.com/phish",
        "javascript:alert('redirected')",
    ] {
        assert!(
            matches!(
                validate_original_url(Some(original_url)),
                Err(OriginalUrlValidationError::Disallowed(_))
            ),
            "{original_url} should be rejected"
        );
    }
}

#[test]
fn callback_original_url_validates_decoded_destination() {
    let encoded_url = urlencoding::encode("https://evil.example.com/phish");

    assert!(matches!(
        validate_original_url(Some(&encoded_url)),
        Err(OriginalUrlValidationError::Disallowed(_))
    ));
}

#[test]
fn callback_original_url_rejects_invalid_urls() {
    assert!(matches!(
        validate_original_url(Some("%ZZ")),
        Err(OriginalUrlValidationError::Invalid)
    ));
    assert!(validate_original_url(None).is_ok());
}

use crate::account_link_state::{AccountLinkState, AccountLinkStateKey, sign_account_link_state};
use uuid::Uuid;

const NOW: i64 = 1_730_000_000;

fn key() -> AccountLinkStateKey {
    AccountLinkStateKey::new("oauth2 callback state test secret value").unwrap()
}

fn link_state(provider: LinkProvider, exp: i64) -> AccountLinkState {
    AccountLinkState {
        provider,
        identity_provider_id: "idp-for-linking".into(),
        link_id: Uuid::parse_str("0192b8a0-6a2e-7c3e-9b1f-4d5e6f708192").unwrap(),
        fusion_user_id: Uuid::parse_str("8c06ab3e-693c-45a7-8f92-1b5a5bf876ac").unwrap(),
        original_url: Some("https://macro.com/app/inbox-link-callback".into()),
        exp,
    }
}

#[test]
fn callback_accepts_signed_state_issued_for_its_provider() {
    for provider in [
        LinkProvider::Google,
        LinkProvider::Github,
        LinkProvider::Microsoft,
    ] {
        let state = link_state(provider, NOW + 60);
        let token = sign_account_link_state(&state, &key()).unwrap();

        match parse_callback_state(&token, provider.as_str(), &key(), NOW).unwrap() {
            CallbackState::AccountLink(verified) => assert_eq!(verified, state),
            other => panic!("expected an account link for {provider}, got {other:?}"),
        }
    }
}

#[test]
fn outlook_authorization_state_round_trips_through_callback_with_pkce_and_nonce() {
    use crate::{
        domain::microsoft::{LinkAttempt, MicrosoftIdentityProvider},
        outbound::microsoft::MicrosoftOAuthProvider,
    };
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use sha2::{Digest, Sha256};
    use std::{collections::HashMap, sync::Arc};
    use zeroize::Zeroizing;

    let client = fusionauth::FusionAuthClient::new(
        "api-key".into(),
        "client-id".into(),
        "client-secret".into(),
        "https://auth.example.com".into(),
        "https://macro.com/app".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
    .with_microsoft_credentials(
        "microsoft-client-id".into(),
        "microsoft-client-secret".into(),
        "common".into(),
    );
    let provider = MicrosoftOAuthProvider::new(Arc::new(client), key());
    let expected = link_state(LinkProvider::Microsoft, NOW + 600);

    for calendar_requested in [false, true] {
        let attempt = LinkAttempt {
            id: expected.link_id,
            owner: expected.fusion_user_id,
            identity_provider_id: expected.identity_provider_id.clone(),
            redirect_uri: "https://auth.example.com/oauth2/microsoft/callback".into(),
            return_uri: expected.original_url.clone(),
            verifier: Zeroizing::new("server-owned-pkce-verifier".into()),
            nonce: "server-owned-nonce".into(),
            calendar_requested,
            expires_at: chrono::DateTime::from_timestamp(expected.exp, 0).unwrap(),
        };
        let url = url::Url::parse(&provider.authorize(&attempt).unwrap()).unwrap();
        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
        let token = &query["state"];

        match parse_callback_state(token, "microsoft", &key(), NOW).unwrap() {
            CallbackState::AccountLink(verified) => assert_eq!(verified, expected),
            other => panic!("expected signed Microsoft link state, got {other:?}"),
        }
        assert_eq!(query["redirect_uri"], attempt.redirect_uri);
        assert_eq!(query["nonce"], attempt.nonce);
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(
            query["code_challenge"],
            URL_SAFE_NO_PAD.encode(Sha256::digest(attempt.verifier.as_bytes()))
        );
        assert_eq!(
            query["scope"]
                .split_whitespace()
                .any(|scope| scope == "Calendars.ReadWrite"),
            calendar_requested
        );
        assert_eq!(
            parse_callback_state(token, "google", &key(), NOW).unwrap_err(),
            CallbackStateError::ProviderMismatch {
                issued_for: LinkProvider::Microsoft
            }
        );
        assert_eq!(
            parse_callback_state(token, "microsoft", &key(), expected.exp).unwrap_err(),
            CallbackStateError::Signed(AccountLinkStateError::Expired {
                link_id: attempt.id
            })
        );
        assert_eq!(
            parse_callback_state(&format!("A{token}"), "microsoft", &key(), NOW).unwrap_err(),
            CallbackStateError::Signed(AccountLinkStateError::InvalidSignature)
        );
    }
}

#[test]
fn callback_rejects_signed_state_issued_for_another_provider() {
    let token =
        sign_account_link_state(&link_state(LinkProvider::Github, NOW + 60), &key()).unwrap();

    assert_eq!(
        parse_callback_state(&token, "google", &key(), NOW).unwrap_err(),
        CallbackStateError::ProviderMismatch {
            issued_for: LinkProvider::Github
        }
    );
}

#[test]
fn callback_rejects_expired_foreign_and_garbage_tokens() {
    let state = link_state(LinkProvider::Google, NOW);
    let expired = sign_account_link_state(&state, &key()).unwrap();
    let other_key = AccountLinkStateKey::new("a different signing key of enough length").unwrap();
    let foreign =
        sign_account_link_state(&link_state(LinkProvider::Google, NOW + 60), &other_key).unwrap();

    assert_eq!(
        parse_callback_state(&expired, "google", &key(), NOW).unwrap_err(),
        CallbackStateError::Signed(AccountLinkStateError::Expired {
            link_id: state.link_id
        })
    );
    assert_eq!(
        parse_callback_state(&foreign, "google", &key(), NOW).unwrap_err(),
        CallbackStateError::Signed(AccountLinkStateError::InvalidSignature)
    );
    assert_eq!(
        parse_callback_state("not-a-token", "google", &key(), NOW).unwrap_err(),
        CallbackStateError::Signed(AccountLinkStateError::Malformed)
    );
}

#[test]
fn callback_accepts_unsigned_state_only_for_sign_in() {
    let login = parse_callback_state(
        r#"{"identity_provider_id":"google-login","is_mobile":true}"#,
        "google",
        &key(),
        NOW,
    )
    .unwrap();
    match login {
        CallbackState::Login(state) => {
            assert_eq!(state.identity_provider_id, "google-login");
            assert_eq!(state.is_mobile, Some(true));
            assert!(state.link_id.is_none());
            assert!(state.original_url.is_none());
        }
        other => panic!("expected sign-in state, got {other:?}"),
    }

    // The pre-signing wire format: an attacker-chosen link_id in plain JSON.
    let forged = format!(
        r#"{{"identity_provider_id":"google-gmail","link_id":"{}","original_url":"https://macro.com/app"}}"#,
        Uuid::now_v7()
    );
    assert_eq!(
        parse_callback_state(&forged, "google", &key(), NOW).unwrap_err(),
        CallbackStateError::UnsignedAccountLink
    );
    assert_eq!(
        parse_callback_state("{not json", "google", &key(), NOW).unwrap_err(),
        CallbackStateError::Unparseable
    );
}

#[test]
fn verified_link_state_converts_to_provider_handler_state() {
    let link = link_state(LinkProvider::Microsoft, NOW + 60);

    let state = OAuthState::from(&link);

    assert_eq!(state.identity_provider_id, link.identity_provider_id);
    assert_eq!(state.link_id, Some(link.link_id));
    assert_eq!(state.original_url, link.original_url);
    assert_eq!(state.is_mobile, None);
}
