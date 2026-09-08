use std::time::{Duration, SystemTime};

use super::*;
use crate::{
    domain::models::{AccessToken, ClientRegistrationRequest},
    test_support::{
        ATTACKER_CODE_VERIFIER, ATTACKER_REDIRECT_URI, FakeOAuthProvider, Harness,
        LOOPBACK_REDIRECT_URI, REFRESHED_ACCESS_TOKEN, TRUSTED_REDIRECT_URI, UPSTREAM_ACCESS_TOKEN,
        UPSTREAM_EXPIRES_IN, UPSTREAM_REFRESH_TOKEN, VICTIM_CODE_VERIFIER, code_challenge_for,
    },
};

// --- Registration -------------------------------------------------------

#[tokio::test]
async fn registration_persists_the_submitted_redirect_uris() {
    let harness = Harness::new();
    let client_id = harness.register(&[LOOPBACK_REDIRECT_URI]).await;

    let stored = harness
        .registry
        .find_client(&client_id)
        .await
        .expect("lookup should succeed")
        .expect("client should be persisted");

    assert_eq!(stored.redirect_uris, vec![LOOPBACK_REDIRECT_URI]);
}

#[tokio::test]
async fn registration_rejects_an_untrusted_https_redirect_uri() {
    let harness = Harness::new();

    let error = harness
        .service
        .register_client(ClientRegistrationRequest {
            client_name: None,
            redirect_uris: vec![ATTACKER_REDIRECT_URI.to_owned()],
        })
        .await
        .expect_err("an untrusted host must not be registrable");

    assert!(matches!(
        error,
        RegisterClientError::UnsupportedRedirectUri { .. }
    ));
}

#[tokio::test]
async fn registration_rejects_an_empty_redirect_uri_list() {
    let harness = Harness::new();

    let error = harness
        .service
        .register_client(ClientRegistrationRequest {
            client_name: None,
            redirect_uris: Vec::new(),
        })
        .await
        .expect_err("a client with no redirect_uri must be rejected");

    assert!(matches!(error, RegisterClientError::RedirectUrisRequired));
}

// --- Authorization ------------------------------------------------------

#[tokio::test]
async fn authorize_rejects_an_unknown_client_id() {
    let harness = Harness::new();

    let error = harness
        .service
        .start_authorization(harness.authorize_request(
            "never-registered",
            LOOPBACK_REDIRECT_URI,
            &code_challenge_for(VICTIM_CODE_VERIFIER),
        ))
        .await
        .expect_err("an unregistered client_id must be rejected");

    assert!(matches!(error, StartAuthorizationError::UnknownClient));
}

#[tokio::test]
async fn authorize_rejects_a_redirect_uri_the_client_did_not_register() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    let error = harness
        .service
        .start_authorization(harness.authorize_request(
            &client_id,
            "https://claude.ai/some/other/path",
            &code_challenge_for(VICTIM_CODE_VERIFIER),
        ))
        .await
        .expect_err("a redirect_uri outside the registration must be rejected");

    assert!(matches!(
        error,
        StartAuthorizationError::UnregisteredRedirectUri
    ));
}

#[tokio::test]
async fn authorize_rejects_an_attacker_controlled_redirect_uri() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    let error = harness
        .service
        .start_authorization(harness.authorize_request(
            &client_id,
            ATTACKER_REDIRECT_URI,
            &code_challenge_for(ATTACKER_CODE_VERIFIER),
        ))
        .await
        .expect_err("an untrusted host must be rejected at authorize");

    assert!(matches!(error, StartAuthorizationError::InvalidRedirectUri));
}

/// The reported attack: an attacker registers a client, crafts an authorize
/// link carrying a redirect URI and PKCE challenge of their own, and gets a
/// victim to follow it. Every check the broker makes at token exchange
/// compares the attacker's values against the attacker's values, so the flow
/// has to fail before a code is ever issued.
#[tokio::test]
async fn authorization_code_interception_fails_at_authorize() {
    let harness = Harness::new();

    let attacker_registration = harness
        .service
        .register_client(ClientRegistrationRequest {
            client_name: Some("totally-legitimate-client".to_owned()),
            redirect_uris: vec![ATTACKER_REDIRECT_URI.to_owned()],
        })
        .await;
    assert!(
        attacker_registration.is_err(),
        "the attacker must not be able to register their callback"
    );

    // Registration refused, so the attacker reuses a real client's id and
    // supplies their own callback on the authorize request instead.
    let victim_client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let error = harness
        .service
        .start_authorization(harness.authorize_request(
            &victim_client_id,
            ATTACKER_REDIRECT_URI,
            &code_challenge_for(ATTACKER_CODE_VERIFIER),
        ))
        .await
        .expect_err("the crafted authorize request must fail");

    assert!(matches!(error, StartAuthorizationError::InvalidRedirectUri));
    assert!(
        !harness.inflight.has_pending(),
        "no handshake state may be created for a rejected authorize request"
    );
}

// --- Token exchange ----------------------------------------------------

#[tokio::test]
async fn authorization_code_grant_returns_upstream_tokens() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;

    let response = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".to_owned(),
            code: Some(code),
            code_verifier: Some(VICTIM_CODE_VERIFIER.to_owned()),
            refresh_token: None,
            redirect_uri: Some(TRUSTED_REDIRECT_URI.to_owned()),
            client_id: Some(client_id),
        })
        .await
        .expect("the legitimate client should get its tokens");

    assert_eq!(response.access_token.as_str(), UPSTREAM_ACCESS_TOKEN);
    assert_eq!(response.refresh_token.as_str(), UPSTREAM_REFRESH_TOKEN);
}

#[tokio::test]
async fn authorization_code_grant_requires_a_client_id() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;

    let error = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".to_owned(),
            code: Some(code.clone()),
            code_verifier: Some(VICTIM_CODE_VERIFIER.to_owned()),
            refresh_token: None,
            redirect_uri: Some(TRUSTED_REDIRECT_URI.to_owned()),
            client_id: None,
        })
        .await
        .expect_err("a token request without client_id must be rejected");

    assert!(matches!(error, TokenExchangeError::ClientIdRequired));
    assert!(
        harness.inflight.holds_issued_code(&code),
        "a request rejected before validation must not spend the code"
    );
}

#[tokio::test]
async fn authorization_code_grant_rejects_a_different_client() {
    let harness = Harness::new();
    let victim_client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let other_client_id = harness.register(&[LOOPBACK_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(
            &victim_client_id,
            TRUSTED_REDIRECT_URI,
            VICTIM_CODE_VERIFIER,
        )
        .await;

    let error = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".to_owned(),
            code: Some(code),
            code_verifier: Some(VICTIM_CODE_VERIFIER.to_owned()),
            refresh_token: None,
            redirect_uri: Some(TRUSTED_REDIRECT_URI.to_owned()),
            client_id: Some(other_client_id),
        })
        .await
        .expect_err("a code must only be redeemable by the client it was issued to");

    assert!(matches!(error, TokenExchangeError::ClientMismatch));
}

// --- Refresh grant ----------------------------------------------------

#[tokio::test]
async fn refresh_grant_succeeds_for_the_client_the_token_was_issued_to() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;

    let issued = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".to_owned(),
            code: Some(code),
            code_verifier: Some(VICTIM_CODE_VERIFIER.to_owned()),
            refresh_token: None,
            redirect_uri: Some(TRUSTED_REDIRECT_URI.to_owned()),
            client_id: Some(client_id.clone()),
        })
        .await
        .expect("code exchange should succeed");

    let refreshed = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(issued.refresh_token),
            redirect_uri: None,
            client_id: Some(client_id),
        })
        .await
        .expect("the bound client should be able to refresh");

    assert_eq!(refreshed.access_token.as_str(), REFRESHED_ACCESS_TOKEN);
}

#[tokio::test]
async fn refresh_grant_rejects_an_unbound_refresh_token() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    let error = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(RefreshToken::from(UPSTREAM_REFRESH_TOKEN)),
            redirect_uri: None,
            client_id: Some(client_id),
        })
        .await
        .expect_err("a refresh token the broker never issued must be rejected");

    assert!(matches!(error, TokenExchangeError::UnboundRefreshToken));
}

#[tokio::test]
async fn refresh_grant_rejects_a_client_the_token_was_not_issued_to() {
    let harness = Harness::new();
    let owner_client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let other_client_id = harness.register(&[LOOPBACK_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&owner_client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;

    let issued = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".to_owned(),
            code: Some(code),
            code_verifier: Some(VICTIM_CODE_VERIFIER.to_owned()),
            refresh_token: None,
            redirect_uri: Some(TRUSTED_REDIRECT_URI.to_owned()),
            client_id: Some(owner_client_id),
        })
        .await
        .expect("code exchange should succeed");

    let error = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(issued.refresh_token),
            redirect_uri: None,
            client_id: Some(other_client_id),
        })
        .await
        .expect_err("another client must not be able to use this refresh token");

    assert!(matches!(error, TokenExchangeError::ClientMismatch));
}

#[tokio::test]
async fn refresh_grant_requires_a_client_id() {
    let harness = Harness::new();

    let error = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(RefreshToken::from(UPSTREAM_REFRESH_TOKEN)),
            redirect_uri: None,
            client_id: None,
        })
        .await
        .expect_err("a refresh without client_id must be rejected");

    assert!(matches!(error, TokenExchangeError::ClientIdRequired));
}

#[tokio::test]
async fn rotated_refresh_token_is_rebound_and_the_old_one_is_refused() {
    let harness = Harness::with_provider(FakeOAuthProvider::rotating("rotated-refresh-token"));
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;

    let issued = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".to_owned(),
            code: Some(code),
            code_verifier: Some(VICTIM_CODE_VERIFIER.to_owned()),
            refresh_token: None,
            redirect_uri: Some(TRUSTED_REDIRECT_URI.to_owned()),
            client_id: Some(client_id.clone()),
        })
        .await
        .expect("code exchange should succeed");
    let original_refresh_token = issued.refresh_token.clone();

    let refreshed = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(original_refresh_token.clone()),
            redirect_uri: None,
            client_id: Some(client_id.clone()),
        })
        .await
        .expect("the bound client should be able to refresh");
    assert_eq!(refreshed.refresh_token.as_str(), "rotated-refresh-token");

    let replay = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(original_refresh_token),
            redirect_uri: None,
            client_id: Some(client_id.clone()),
        })
        .await
        .expect_err("the superseded refresh token must not work again");
    assert!(matches!(replay, TokenExchangeError::UnboundRefreshToken));

    let rotated = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(refreshed.refresh_token),
            redirect_uri: None,
            client_id: Some(client_id),
        })
        .await;
    assert!(rotated.is_ok(), "the rotated token must be usable");
}

// --- Redirect construction -------------------------------------------

#[tokio::test]
async fn callback_redirect_preserves_a_query_on_the_registered_redirect_uri() {
    let harness = Harness::new();
    let redirect_uri = "https://claude.ai/api/mcp/auth_callback?tenant=macro";
    let client_id = harness.register(&[redirect_uri]).await;

    harness
        .service
        .start_authorization(harness.authorize_request(
            &client_id,
            redirect_uri,
            &code_challenge_for(VICTIM_CODE_VERIFIER),
        ))
        .await
        .expect("authorize should succeed");

    let redirect = harness
        .service
        .complete_callback(CallbackRequest {
            code: Some("upstream-code".to_owned()),
            state: Some(harness.inflight.only_pending_session_id()),
            error: None,
            error_description: None,
        })
        .await
        .expect("callback should succeed");

    assert!(
        redirect.starts_with("https://claude.ai/api/mcp/auth_callback?tenant=macro&code="),
        "unexpected redirect: {redirect}"
    );
    assert!(redirect.contains("&state=client-state"));
}

// --- Upstream token lifetime ------------------------------------------

/// Seeds a broker code for `client_id` expiring at `access_token_expires_at`,
/// bypassing the handshake so the expiry under test is exact.
async fn seed_issued_code(
    harness: &Harness,
    code: &str,
    client_id: &str,
    access_token_expires_at: Option<SystemTime>,
) {
    harness
        .inflight
        .insert_issued(
            code,
            IssuedAuthorizationCode {
                client_id: client_id.to_owned(),
                access_token: AccessToken::from(UPSTREAM_ACCESS_TOKEN),
                refresh_token: RefreshToken::from(UPSTREAM_REFRESH_TOKEN),
                code_challenge: code_challenge_for(VICTIM_CODE_VERIFIER),
                redirect_uri: TRUSTED_REDIRECT_URI.to_owned(),
                access_token_expires_at,
            },
        )
        .await
        .expect("seeding an issued code should succeed");
}

fn authorization_code_request(code: &str, client_id: &str) -> TokenRequest {
    TokenRequest {
        grant_type: "authorization_code".to_owned(),
        code: Some(code.to_owned()),
        code_verifier: Some(VICTIM_CODE_VERIFIER.to_owned()),
        refresh_token: None,
        redirect_uri: Some(TRUSTED_REDIRECT_URI.to_owned()),
        client_id: Some(client_id.to_owned()),
    }
}

#[tokio::test]
async fn authorization_code_exchange_returns_remaining_lifetime() {
    // Issued five minutes ago, so the client should be told what is left rather
    // than the full upstream lifetime.
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let expires_at = SystemTime::now() + Duration::from_secs(UPSTREAM_EXPIRES_IN - 300);
    seed_issued_code(&harness, "broker-code", &client_id, Some(expires_at)).await;

    let response = harness
        .service
        .exchange_token(authorization_code_request("broker-code", &client_id))
        .await
        .expect("token exchange should succeed");

    let expires_in = response.expires_in.expect("expires_in should be present");
    assert!(
        (UPSTREAM_EXPIRES_IN - 302..=UPSTREAM_EXPIRES_IN - 300).contains(&expires_in),
        "expected roughly {} seconds remaining, got {expires_in}",
        UPSTREAM_EXPIRES_IN - 300
    );
}

#[tokio::test]
async fn authorization_code_exchange_serializes_expires_in() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    seed_issued_code(
        &harness,
        "broker-code",
        &client_id,
        Some(SystemTime::now() + Duration::from_secs(UPSTREAM_EXPIRES_IN)),
    )
    .await;

    let response = harness
        .service
        .exchange_token(authorization_code_request("broker-code", &client_id))
        .await
        .expect("token exchange should succeed");

    let json = serde_json::to_value(&response).expect("response should serialize");
    assert_eq!(json["token_type"], "Bearer");
    assert!(
        json.get("expires_in").is_some_and(|v| v.is_u64()),
        "expires_in should be serialized as a number, got {json}"
    );
}

#[tokio::test]
async fn authorization_code_exchange_omits_unknown_expiry() {
    // Codes issued before the broker tracked upstream lifetimes have no expiry,
    // and must not report a fabricated one.
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    seed_issued_code(&harness, "broker-code", &client_id, None).await;

    let response = harness
        .service
        .exchange_token(authorization_code_request("broker-code", &client_id))
        .await
        .expect("token exchange should succeed");

    assert_eq!(response.expires_in, None);
    let json = serde_json::to_value(&response).expect("response should serialize");
    assert!(
        json.get("expires_in").is_none(),
        "expires_in should be omitted when unknown, got {json}"
    );
}

#[tokio::test]
async fn expired_access_token_reports_zero_rather_than_underflowing() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    seed_issued_code(
        &harness,
        "broker-code",
        &client_id,
        Some(SystemTime::now() - Duration::from_secs(60)),
    )
    .await;

    let response = harness
        .service
        .exchange_token(authorization_code_request("broker-code", &client_id))
        .await
        .expect("token exchange should succeed");

    assert_eq!(response.expires_in, Some(0));
}

#[tokio::test]
async fn refresh_grant_returns_upstream_lifetime() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;

    let issued = harness
        .service
        .exchange_token(authorization_code_request(&code, &client_id))
        .await
        .expect("code exchange should succeed");

    let refreshed = harness
        .service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(issued.refresh_token),
            redirect_uri: None,
            client_id: Some(client_id),
        })
        .await
        .expect("refresh exchange should succeed");

    assert_eq!(refreshed.expires_in, Some(UPSTREAM_EXPIRES_IN));
    assert_eq!(refreshed.access_token.as_str(), REFRESHED_ACCESS_TOKEN);
}

#[tokio::test]
async fn callback_records_upstream_expiry_on_the_issued_code() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    harness
        .service
        .start_authorization(harness.authorize_request(
            &client_id,
            TRUSTED_REDIRECT_URI,
            &code_challenge_for(VICTIM_CODE_VERIFIER),
        ))
        .await
        .expect("authorize should succeed");

    harness
        .service
        .complete_callback(CallbackRequest {
            code: Some("upstream-code".to_owned()),
            state: Some(harness.inflight.only_pending_session_id()),
            error: None,
            error_description: None,
        })
        .await
        .expect("callback should succeed");

    let remaining = harness
        .inflight
        .only_issued_expiry()
        .expect("issued code should record the upstream expiry")
        .duration_since(SystemTime::now())
        .expect("expiry should be in the future")
        .as_secs();
    assert!(
        (UPSTREAM_EXPIRES_IN - 2..=UPSTREAM_EXPIRES_IN).contains(&remaining),
        "expected roughly {UPSTREAM_EXPIRES_IN} seconds remaining, got {remaining}"
    );
}
