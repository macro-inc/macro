use std::time::{Duration, SystemTime};

use super::*;
use crate::{
    domain::{
        browser_binding::BrowserBinding,
        models::{AccessToken, ClientRegistrationRequest},
    },
    test_support::{
        ATTACKER_CODE_VERIFIER, ATTACKER_REDIRECT_URI, CHATGPT_RESOURCE, FakeOAuthProvider,
        GATEWAY_REDIRECT_URI, HARNESS_RESOURCE, Harness, LOOPBACK_REDIRECT_URI,
        MINTED_LIFETIME_CAP_SECONDS, REFRESHED_ACCESS_TOKEN, TRUSTED_REDIRECT_URI,
        UPSTREAM_ACCESS_TOKEN, UPSTREAM_EXPIRES_IN, UPSTREAM_REFRESH_TOKEN, VICTIM_CODE_VERIFIER,
        code_challenge_for,
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
async fn registration_accepts_an_unlisted_https_redirect_uri() {
    let harness = Harness::new();
    let client_id = harness.register(&[GATEWAY_REDIRECT_URI]).await;

    let stored = harness
        .registry
        .find_client(&client_id)
        .await
        .expect("lookup should succeed")
        .expect("client should be persisted");

    assert_eq!(stored.redirect_uris, vec![GATEWAY_REDIRECT_URI]);
}

#[tokio::test]
async fn registration_rejects_a_non_loopback_http_redirect_uri() {
    let harness = Harness::new();

    let error = harness
        .service
        .register_client(ClientRegistrationRequest {
            client_name: None,
            redirect_uris: vec!["http://gateway.example/oauth/callback".to_owned()],
        })
        .await
        .expect_err("plain http off loopback must not be registrable");

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
        .start_authorization(
            harness.authorize_request(
                "never-registered",
                LOOPBACK_REDIRECT_URI,
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::NotAsked,
        )
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
        .start_authorization(
            harness.authorize_request(
                &client_id,
                "https://claude.ai/some/other/path",
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::NotAsked,
        )
        .await
        .expect_err("a redirect_uri outside the registration must be rejected");

    assert!(matches!(
        error,
        StartAuthorizationError::UnregisteredRedirectUri
    ));
}

#[tokio::test]
async fn authorize_rejects_an_unregistered_attacker_redirect_uri() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    let error = harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                ATTACKER_REDIRECT_URI,
                &code_challenge_for(ATTACKER_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::Approved,
        )
        .await
        .expect_err("a callback the client did not register must be rejected");

    assert!(matches!(
        error,
        StartAuthorizationError::UnregisteredRedirectUri
    ));
    assert!(!harness.inflight.has_pending());
}

#[tokio::test]
async fn authorize_rejects_a_redirect_uri_the_policy_refuses() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    let error = harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                "http://attacker.example/steal",
                &code_challenge_for(ATTACKER_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::Approved,
        )
        .await
        .expect_err("plain http off loopback must be rejected at authorize");

    assert!(matches!(error, StartAuthorizationError::InvalidRedirectUri));
}

#[tokio::test]
async fn authorize_for_an_unlisted_host_asks_for_consent_and_stores_nothing() {
    let harness = Harness::new();
    let client_id = harness.register(&[GATEWAY_REDIRECT_URI]).await;

    let start = harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                GATEWAY_REDIRECT_URI,
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::NotAsked,
        )
        .await
        .expect("authorize should succeed");

    assert_eq!(
        start,
        AuthorizationStart::ConsentRequired(ConsentPrompt {
            client_name: "test-client".to_owned(),
            redirect_host: "gateway.example".to_owned(),
            delivery: crate::domain::models::CodeDelivery::Redirect,
        })
    );
    assert!(
        !harness.inflight.has_pending(),
        "nothing may be stored before the user answers"
    );
}

#[tokio::test]
async fn authorize_for_a_trusted_host_signs_in_without_consent() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    let start = harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                TRUSTED_REDIRECT_URI,
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::NotAsked,
        )
        .await
        .expect("authorize should succeed");

    assert!(matches!(start, AuthorizationStart::SignIn(_)));
}

#[tokio::test]
async fn approved_client_on_an_unlisted_host_completes_the_flow() {
    let harness = Harness::new();
    let client_id = harness.register(&[GATEWAY_REDIRECT_URI]).await;

    let start = harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                GATEWAY_REDIRECT_URI,
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::Approved,
        )
        .await
        .expect("authorize should succeed");
    assert!(matches!(start, AuthorizationStart::SignIn(_)));

    let redirect = harness
        .service
        .complete_callback(
            upstream_callback(&harness.inflight.only_pending_session_id()),
            Some(harness.browser.clone()),
        )
        .await
        .expect("callback should succeed")
        .url;

    assert!(
        redirect.starts_with(&format!("{GATEWAY_REDIRECT_URI}?code=")),
        "unexpected redirect: {redirect}"
    );
}

/// The attack the consent screen alone does not stop: an attacker approves
/// their own client, takes the upstream sign-in URL that produces, and sends
/// it to a victim, whose existing upstream session completes it silently. The
/// callback arrives in the victim's browser, which does not hold the binding
/// the flow was started with, so no code is issued.
#[tokio::test]
async fn a_flow_started_in_another_browser_cannot_be_completed() {
    let harness = Harness::new();
    let client_id = harness.register(&[ATTACKER_REDIRECT_URI]).await;
    let attacker_browser = BrowserBinding::generate();

    harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                ATTACKER_REDIRECT_URI,
                &code_challenge_for(ATTACKER_CODE_VERIFIER),
            ),
            attacker_browser,
            UserConsent::Approved,
        )
        .await
        .expect("the attacker can approve their own client");
    let session_id = harness.inflight.only_pending_session_id();

    let error = harness
        .service
        .complete_callback(
            upstream_callback(&session_id),
            Some(harness.browser.clone()),
        )
        .await
        .expect_err("the victim's browser must not complete the attacker's flow");

    assert!(matches!(error, CompleteCallbackError::DifferentBrowser));
    assert!(!harness.inflight.holds_any_issued_code());
}

#[tokio::test]
async fn a_callback_without_the_binding_cookie_is_refused() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                TRUSTED_REDIRECT_URI,
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::NotAsked,
        )
        .await
        .expect("authorize should succeed");

    let error = harness
        .service
        .complete_callback(
            upstream_callback(&harness.inflight.only_pending_session_id()),
            None,
        )
        .await
        .expect_err("a callback without the cookie must be refused");

    assert!(matches!(error, CompleteCallbackError::DifferentBrowser));
}

/// A flow stored by the build before browser binding carries no digest. That
/// build only accepted trusted redirect URIs, so only those may complete
/// unbound.
#[tokio::test]
async fn an_unbound_pending_flow_completes_only_to_a_trusted_redirect_uri() {
    let harness = Harness::new();

    for (redirect_uri, completes) in [(TRUSTED_REDIRECT_URI, true), (GATEWAY_REDIRECT_URI, false)] {
        let session_id = format!("legacy-{completes}");
        harness
            .inflight
            .insert_pending(
                &session_id,
                PendingAuthorization {
                    client_id: "legacy-client".to_owned(),
                    code_challenge: code_challenge_for(VICTIM_CODE_VERIFIER),
                    client_state: "client-state".to_owned(),
                    client_redirect_uri: redirect_uri.to_owned(),
                    browser_binding_digest: None,
                    delivery: crate::domain::models::CodeDelivery::Redirect,
                },
            )
            .await
            .expect("insert should succeed");

        let result = harness
            .service
            .complete_callback(upstream_callback(&session_id), None)
            .await;

        assert_eq!(result.is_ok(), completes, "redirect_uri {redirect_uri}");
    }
}

#[tokio::test]
async fn consent_prompt_strips_formatting_tricks_from_the_client_name() {
    let harness = Harness::new();
    let registration = harness
        .service
        .register_client(ClientRegistrationRequest {
            client_name: Some(format!(
                "Claude\u{202E}moc.elgoog\u{200B}\n{}",
                "x".repeat(100)
            )),
            redirect_uris: vec!["https://xn--claud-7ra.example:8443/callback".to_owned()],
        })
        .await
        .expect("registration should succeed");

    let start = harness
        .service
        .start_authorization(
            harness.authorize_request(
                &registration.client_id,
                "https://xn--claud-7ra.example:8443/callback",
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::NotAsked,
        )
        .await
        .expect("authorize should succeed");

    let AuthorizationStart::ConsentRequired(prompt) = start else {
        panic!("an unlisted host must ask for consent");
    };
    let expected_name = format!("Claudemoc.elgoog{}\u{2026}", "x".repeat(48));
    assert_eq!(prompt.client_name, expected_name);
    assert_eq!(prompt.redirect_host, "xn--claud-7ra.example:8443");
}

fn upstream_callback(session_id: &str) -> CallbackRequest {
    CallbackRequest {
        code: Some("upstream-code".to_owned()),
        state: Some(session_id.to_owned()),
        error: None,
        error_description: None,
    }
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
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
            resource: None,
        })
        .await;
    assert!(rotated.is_ok(), "the rotated token must be usable");
}

// --- Revocation ------------------------------------------------------

/// Takes `client_id` through authorize, callback, and code exchange, returning
/// the refresh token it ends up holding.
async fn obtain_refresh_token(harness: &Harness, client_id: &str) -> RefreshToken {
    let code = harness
        .complete_flow_to_code(client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;
    harness
        .service
        .exchange_token(authorization_code_request(&code, client_id))
        .await
        .expect("code exchange should succeed")
        .refresh_token
}

fn refresh_request(refresh_token: RefreshToken, client_id: &str) -> TokenRequest {
    TokenRequest {
        grant_type: "refresh_token".to_owned(),
        code: None,
        code_verifier: None,
        refresh_token: Some(refresh_token),
        redirect_uri: None,
        client_id: Some(client_id.to_owned()),
        resource: None,
    }
}

#[tokio::test]
async fn revoked_refresh_token_cannot_mint_access_tokens() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;

    harness
        .service
        .revoke_token(RevocationRequest {
            token: Some(refresh_token.clone()),
            client_id: Some(client_id.clone()),
        })
        .await
        .expect("the owning client should be able to revoke");

    assert!(
        harness.provider.revoked(UPSTREAM_REFRESH_TOKEN),
        "the upstream refresh token must be revoked too"
    );
    let error = harness
        .service
        .exchange_token(refresh_request(refresh_token, &client_id))
        .await
        .expect_err("a revoked refresh token must not mint an access token");
    assert!(matches!(error, TokenExchangeError::UnboundRefreshToken));
}

#[tokio::test]
async fn a_refresh_token_the_upstream_refuses_is_an_invalid_grant() {
    let harness = Harness::with_provider(FakeOAuthProvider::new().failing_refresh(|| {
        UpstreamGrantError::InvalidGrant {
            detail: "invalid_grant (refresh_token_not_found)".to_owned(),
        }
    }));
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;

    let error = harness
        .service
        .exchange_token(refresh_request(refresh_token, &client_id))
        .await
        .expect_err("a refused refresh token must not mint an access token");

    match error {
        TokenExchangeError::RefreshFailed(UpstreamGrantError::InvalidGrant { detail }) => {
            assert_eq!(detail, "invalid_grant (refresh_token_not_found)");
        }
        other => panic!("expected an upstream invalid grant, got {other:?}"),
    }
}

#[tokio::test]
async fn an_upstream_outage_during_refresh_is_reported_as_unavailable() {
    let harness = Harness::with_provider(FakeOAuthProvider::new().failing_refresh(|| {
        UpstreamGrantError::Unavailable {
            retry_after: Some(Duration::from_secs(30)),
        }
    }));
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;

    let error = harness
        .service
        .exchange_token(refresh_request(refresh_token, &client_id))
        .await
        .expect_err("an outage must fail the refresh");

    assert!(matches!(
        error,
        TokenExchangeError::RefreshFailed(UpstreamGrantError::Unavailable {
            retry_after: Some(retry_after),
        }) if retry_after == Duration::from_secs(30)
    ));
}

#[tokio::test]
async fn a_failed_upstream_refresh_keeps_its_cause() {
    let harness = Harness::with_provider(
        FakeOAuthProvider::new()
            .failing_refresh(|| UpstreamGrantError::Failed(anyhow::anyhow!("unexpected 500"))),
    );
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;

    let error = harness
        .service
        .exchange_token(refresh_request(refresh_token, &client_id))
        .await
        .expect_err("an upstream failure must fail the refresh");

    assert!(matches!(
        error,
        TokenExchangeError::RefreshFailed(UpstreamGrantError::Failed(_))
    ));
    assert!(
        error.to_string().contains("unexpected 500"),
        "the cause must survive into the message: {error}"
    );
}

#[tokio::test]
async fn a_refused_upstream_code_fails_the_callback_without_issuing_a_code() {
    let harness = Harness::with_provider(FakeOAuthProvider::new().failing_code_exchange(|| {
        UpstreamGrantError::InvalidGrant {
            detail: "invalid_request (auth_code_not_found)".to_owned(),
        }
    }));
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                TRUSTED_REDIRECT_URI,
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::NotAsked,
        )
        .await
        .expect("authorize should succeed");

    let error = harness
        .service
        .complete_callback(
            upstream_callback(&harness.inflight.only_pending_session_id()),
            Some(harness.browser.clone()),
        )
        .await
        .expect_err("a refused upstream code must fail the callback");

    assert!(matches!(
        error,
        CompleteCallbackError::AuthorizationCodeExchangeFailed(
            UpstreamGrantError::InvalidGrant { .. }
        )
    ));
}

#[tokio::test]
async fn revoking_twice_succeeds() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;

    for _ in 0..2 {
        harness
            .service
            .revoke_token(RevocationRequest {
                token: Some(refresh_token.clone()),
                client_id: Some(client_id.clone()),
            })
            .await
            .expect("revocation must be idempotent");
    }
}

/// An expired refresh token's binding has lapsed, so to the broker it is the
/// same as one it never issued; RFC 7009 answers both with success.
#[tokio::test]
async fn revoking_an_unknown_or_expired_refresh_token_succeeds() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    harness
        .service
        .revoke_token(RevocationRequest {
            token: Some(RefreshToken::from("never-issued-or-expired")),
            client_id: Some(client_id),
        })
        .await
        .expect("an unknown token is not an error");

    assert!(
        !harness.provider.revoked("never-issued-or-expired"),
        "the broker must not forward a token it does not hold"
    );
}

#[tokio::test]
async fn another_client_cannot_revoke_the_grant() {
    let harness = Harness::new();
    let owner_client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let other_client_id = harness.register(&[LOOPBACK_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &owner_client_id).await;

    let error = harness
        .service
        .revoke_token(RevocationRequest {
            token: Some(refresh_token.clone()),
            client_id: Some(other_client_id),
        })
        .await
        .expect_err("a client must not revoke another client's grant");
    assert!(matches!(error, RevokeTokenError::ClientMismatch));

    assert!(!harness.provider.revoked(UPSTREAM_REFRESH_TOKEN));
    harness
        .service
        .exchange_token(refresh_request(refresh_token, &owner_client_id))
        .await
        .expect("the owner's grant must survive the refused revocation");
}

#[tokio::test]
async fn revocation_requires_a_client_id() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;

    let error = harness
        .service
        .revoke_token(RevocationRequest {
            token: Some(refresh_token.clone()),
            client_id: None,
        })
        .await
        .expect_err("an unidentified client must not revoke anything");
    assert!(matches!(error, RevokeTokenError::ClientIdRequired));

    harness
        .service
        .exchange_token(refresh_request(refresh_token, &client_id))
        .await
        .expect("the grant must survive the refused revocation");
}

#[tokio::test]
async fn revoking_an_access_token_is_reported_as_unsupported() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    let error = harness
        .service
        .revoke_token(RevocationRequest {
            token: Some(RefreshToken::from(
                "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl",
            )),
            client_id: Some(client_id),
        })
        .await
        .expect_err("the broker cannot revoke a JWT access token");
    assert!(matches!(error, RevokeTokenError::UnsupportedTokenType));
}

/// A refresh that races a revocation can leave a binding behind for a token
/// rotated out of the revoked grant. The grant marker must refuse it.
#[tokio::test]
async fn revocation_refuses_every_token_in_the_family() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;
    let binding = harness
        .registry
        .binding(&refresh_token_digest(&refresh_token))
        .await
        .expect("lookup should succeed")
        .expect("the issued token should be bound");
    harness
        .registry
        .bind(
            &refresh_token_digest(&RefreshToken::from("rotated-refresh-token")),
            &binding,
        )
        .await
        .expect("seeding the rotated binding should succeed");

    harness
        .service
        .revoke_token(RevocationRequest {
            token: Some(refresh_token),
            client_id: Some(client_id.clone()),
        })
        .await
        .expect("the owning client should be able to revoke");

    let error = harness
        .service
        .exchange_token(refresh_request(
            RefreshToken::from("rotated-refresh-token"),
            &client_id,
        ))
        .await
        .expect_err("a token from the revoked family must not mint an access token");
    assert!(matches!(error, TokenExchangeError::RevokedGrant));
}

#[test]
fn authorization_server_metadata_advertises_revocation() {
    let json = Harness::new().service.authorization_server_metadata();
    assert_eq!(json["revocation_endpoint"], "https://mcp.macro.com/revoke");
    assert_eq!(
        json["revocation_endpoint_auth_methods_supported"],
        serde_json::json!(["none"])
    );
}

// --- Redirect construction -------------------------------------------

#[tokio::test]
async fn callback_redirect_preserves_a_query_on_the_registered_redirect_uri() {
    let harness = Harness::new();
    let redirect_uri = "https://claude.ai/api/mcp/auth_callback?tenant=macro";
    let client_id = harness.register(&[redirect_uri]).await;

    harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                redirect_uri,
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::NotAsked,
        )
        .await
        .expect("authorize should succeed");

    let redirect = harness
        .service
        .complete_callback(
            CallbackRequest {
                code: Some("upstream-code".to_owned()),
                state: Some(harness.inflight.only_pending_session_id()),
                error: None,
                error_description: None,
            },
            Some(harness.browser.clone()),
        )
        .await
        .expect("callback should succeed")
        .url;

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
    access_token_expires_at: SystemTime,
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
        resource: None,
    }
}

#[tokio::test]
async fn authorization_code_exchange_returns_remaining_lifetime() {
    // Issued five minutes ago, so the client should be told what is left rather
    // than the full upstream lifetime.
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let expires_at = SystemTime::now() + Duration::from_secs(UPSTREAM_EXPIRES_IN - 300);
    seed_issued_code(&harness, "broker-code", &client_id, expires_at).await;

    let response = harness
        .service
        .exchange_token(authorization_code_request("broker-code", &client_id))
        .await
        .expect("token exchange should succeed");

    let expires_in = response.expires_in;
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
        SystemTime::now() + Duration::from_secs(UPSTREAM_EXPIRES_IN),
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
async fn expired_access_token_reports_zero_rather_than_underflowing() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    seed_issued_code(
        &harness,
        "broker-code",
        &client_id,
        SystemTime::now() - Duration::from_secs(60),
    )
    .await;

    let response = harness
        .service
        .exchange_token(authorization_code_request("broker-code", &client_id))
        .await
        .expect("token exchange should succeed");

    assert_eq!(response.expires_in, 0);
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
            resource: None,
        })
        .await
        .expect("refresh exchange should succeed");

    assert_eq!(refreshed.expires_in, UPSTREAM_EXPIRES_IN);
    assert_eq!(refreshed.access_token.as_str(), REFRESHED_ACCESS_TOKEN);
}

#[tokio::test]
async fn callback_records_upstream_expiry_on_the_issued_code() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    harness
        .service
        .start_authorization(
            harness.authorize_request(
                &client_id,
                TRUSTED_REDIRECT_URI,
                &code_challenge_for(VICTIM_CODE_VERIFIER),
            ),
            harness.browser.clone(),
            UserConsent::NotAsked,
        )
        .await
        .expect("authorize should succeed");

    harness
        .service
        .complete_callback(
            CallbackRequest {
                code: Some("upstream-code".to_owned()),
                state: Some(harness.inflight.only_pending_session_id()),
                error: None,
                error_description: None,
            },
            Some(harness.browser.clone()),
        )
        .await
        .expect("callback should succeed");

    let remaining = harness
        .inflight
        .only_issued_expiry()
        .duration_since(SystemTime::now())
        .expect("expiry should be in the future")
        .as_secs();
    assert!(
        (UPSTREAM_EXPIRES_IN - 2..=UPSTREAM_EXPIRES_IN).contains(&remaining),
        "expected roughly {UPSTREAM_EXPIRES_IN} seconds remaining, got {remaining}"
    );
}

#[test]
fn protected_resource_metadata_includes_required_resource_url() {
    let json = Harness::new().service.protected_resource_metadata();
    assert_eq!(
        json,
        serde_json::json!({
            "resource": "https://mcp.macro.com/mcp",
            "authorization_server": "https://mcp.macro.com",
            "authorization_servers": ["https://mcp.macro.com"],
        })
    );
}

// --- Access token clients ------------------------------------------------

#[tokio::test]
async fn both_token_exchanges_record_the_client_behind_the_access_token() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;
    harness
        .service
        .exchange_token(refresh_request(refresh_token, &client_id))
        .await
        .expect("refreshed");

    let clients = harness.service.access_token_clients();
    for access_token in [UPSTREAM_ACCESS_TOKEN, REFRESHED_ACCESS_TOKEN] {
        assert_eq!(
            clients.client_name(access_token).await.unwrap().as_deref(),
            Some("test-client"),
            "{access_token}"
        );
    }
}

/// The access token's record shares the refresh binding store, under a digest
/// no refresh token produces, so it can never be refreshed with.
#[tokio::test]
async fn an_access_token_cannot_be_presented_as_a_refresh_token() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    obtain_refresh_token(&harness, &client_id).await;

    let error = harness
        .service
        .exchange_token(refresh_request(
            RefreshToken::from(UPSTREAM_ACCESS_TOKEN),
            &client_id,
        ))
        .await
        .expect_err("an access token is not a refresh token");

    assert!(matches!(error, TokenExchangeError::UnboundRefreshToken));
}

// --- Resources (RFC 8707) ----------------------------------------------

#[tokio::test]
async fn authorize_accepts_any_resource() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;

    for resource in [
        HARNESS_RESOURCE,
        CHATGPT_RESOURCE,
        "https://gateway.macro.com/mcp/mcp",
        "https://other.example/mcp",
    ] {
        let mut request = harness.authorize_request(
            &client_id,
            TRUSTED_REDIRECT_URI,
            &code_challenge_for(VICTIM_CODE_VERIFIER),
        );
        request.resource = Some(resource.to_owned());

        let start = harness
            .service
            .start_authorization(request, harness.browser.clone(), UserConsent::NotAsked)
            .await
            .expect("authorize ignores the resource");
        assert!(matches!(start, AuthorizationStart::SignIn(_)), "{resource}");
    }
}

#[tokio::test]
async fn the_harness_resource_gets_the_upstream_access_token() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;
    let mut request = authorization_code_request(&code, &client_id);
    request.resource = Some(HARNESS_RESOURCE.to_owned());

    let response = harness
        .service
        .exchange_token(request)
        .await
        .expect("code exchange should succeed");

    assert_eq!(response.access_token.as_str(), UPSTREAM_ACCESS_TOKEN);
}

/// The ChatGPT server hands its token straight to Macro's APIs, so the token
/// is a Macro API token for the same user, labelled with the client's name and
/// expiring when the upstream token would.
#[tokio::test]
async fn the_chatgpt_resource_gets_a_macro_api_token_naming_the_client() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;
    let mut request = authorization_code_request(&code, &client_id);
    request.resource = Some(CHATGPT_RESOURCE.to_owned());

    let response = harness
        .service
        .exchange_token(request)
        .await
        .expect("code exchange should succeed");

    // The upstream token lives an hour; the signer caps the minted one, and
    // expires_in reports the minted lifetime so the client refreshes in time.
    assert_eq!(
        response.access_token.as_str(),
        "macro-api-token for upstream-access-token via test-client for 900s"
    );
    assert_eq!(response.expires_in, MINTED_LIFETIME_CAP_SECONDS);
    assert_eq!(response.refresh_token.as_str(), UPSTREAM_REFRESH_TOKEN);
}

#[tokio::test]
async fn a_chatgpt_refresh_mints_from_the_refreshed_upstream_token() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;
    let mut request = refresh_request(refresh_token, &client_id);
    request.resource = Some(CHATGPT_RESOURCE.to_owned());

    let response = harness
        .service
        .exchange_token(request)
        .await
        .expect("refresh should succeed");

    assert_eq!(
        response.access_token.as_str(),
        "macro-api-token for refreshed-access-token via test-client for 900s"
    );
    assert_eq!(response.expires_in, MINTED_LIFETIME_CAP_SECONDS);
}

/// Deployed clients send whatever resource they derive from their configured
/// URL; anything but the ChatGPT server's keeps the FusionAuth token they have
/// always received.
#[tokio::test]
async fn an_unrecognized_resource_gets_the_upstream_access_token() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;
    let mut request = authorization_code_request(&code, &client_id);
    request.resource = Some("https://mcp-chatgpt.macro.com".to_owned());

    let response = harness
        .service
        .exchange_token(request)
        .await
        .expect("code exchange should succeed");

    assert_eq!(response.access_token.as_str(), UPSTREAM_ACCESS_TOKEN);
}

#[tokio::test]
async fn a_refresh_with_an_unrecognized_resource_gets_the_upstream_access_token() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let refresh_token = obtain_refresh_token(&harness, &client_id).await;
    let mut request = refresh_request(refresh_token, &client_id);
    request.resource = Some("http://mcp-chatgpt.macro.com/mcp".to_owned());

    let response = harness
        .service
        .exchange_token(request)
        .await
        .expect("refresh should succeed");

    assert_eq!(response.access_token.as_str(), REFRESHED_ACCESS_TOKEN);
}
