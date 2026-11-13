use std::collections::HashMap;

use fusionauth::FusionAuthClient;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use reqwest::redirect::Policy;
use url::Url;

use super::*;
use crate::{Fault, FaultError, Route};

const CLIENT_ID: &str = "macro-client.apps.example.com";
const REDIRECT_URI: &str = "http://localhost:8080/oauth2/google/callback";
const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
const CONTACTS_SCOPE: &str = "https://www.googleapis.com/auth/contacts.readonly";

/// A browser that stops at each redirect, so a test reads where it leads.
fn browser() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(Policy::none())
        .build()
        .unwrap()
}

/// What the authentication service sends a browser to for a Gmail link.
fn authorization_request(scope: &str) -> Vec<(&'static str, String)> {
    vec![
        ("client_id", CLIENT_ID.to_string()),
        ("redirect_uri", REDIRECT_URI.to_string()),
        ("response_type", "code".to_string()),
        ("scope", scope.to_string()),
        ("state", "signed-state".to_string()),
        ("access_type", "offline".to_string()),
        ("include_granted_scopes", "true".to_string()),
        ("prompt", "consent".to_string()),
    ]
}

/// Submits the sign-in page's form and returns the query the browser is sent
/// back to the client with.
async fn submit(
    emulator: &GmailEmulator,
    request: &[(&'static str, String)],
    choice: &[(&'static str, &str)],
) -> HashMap<String, String> {
    let mut form: Vec<(&str, &str)> = request
        .iter()
        .map(|(name, value)| (*name, value.as_str()))
        .collect();
    form.extend_from_slice(choice);
    let response = browser()
        .post(emulator.authorization_url())
        .form(&form)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 303);

    let location = response.headers()["location"].to_str().unwrap();
    assert!(location.starts_with(REDIRECT_URI), "{location}");
    Url::parse(location)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect()
}

/// The production Google OAuth client of the authentication service, pointed
/// at the emulator.
fn oauth_client(emulator: &GmailEmulator) -> FusionAuthClient {
    FusionAuthClient::new(
        "fusionauth-api-key".to_string(),
        "fusionauth-client".to_string(),
        "fusionauth-secret".to_string(),
        "http://127.0.0.1:1".to_string(),
        "http://127.0.0.1:1/oauth/redirect".to_string(),
        CLIENT_ID.to_string(),
        "client-secret".to_string(),
    )
    .with_google_oauth_urls(emulator.token_url(), emulator.revoke_url())
}

#[tokio::test]
async fn a_person_picks_a_seeded_user_and_the_real_client_gets_their_tokens() {
    let emulator = GmailEmulator::start(Seed {
        mailboxes: vec![
            SeedMailbox {
                name: Some("Ada Example".to_string()),
                ..SeedMailbox::new(ADA)
            },
            SeedMailbox::new(BOB),
        ],
        ..Seed::default()
    })
    .await
    .unwrap();
    let request = authorization_request(&format!("openid profile email {GMAIL_SCOPE}"));

    // The page lists the seeded users.
    let page = browser()
        .get(emulator.authorization_url())
        .query(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(page.status().as_u16(), 200);
    let html = page.text().await.unwrap();
    assert!(html.contains("Ada Example") && html.contains(ADA) && html.contains(BOB));

    // Picking Ada sends the browser back with a code and the state.
    let callback = submit(
        &emulator,
        &request,
        &[("user", ADA), ("granted", GMAIL_SCOPE)],
    )
    .await;
    assert_eq!(callback["state"], "signed-state");

    let oauth = oauth_client(&emulator);
    let tokens = oauth
        .exchange_google_code_for_tokens(&callback["code"], REDIRECT_URI)
        .await
        .unwrap();
    assert!(tokens.scope.contains(GMAIL_SCOPE));

    // The ID token is signed by the key the certificates endpoint serves.
    let certs: JwkSet = reqwest::get(emulator.certs_url())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[CLIENT_ID]);
    validation.set_issuer(&["https://accounts.google.com"]);
    let verified = jsonwebtoken::decode::<serde_json::Value>(
        &tokens.id_token,
        &DecodingKey::from_jwk(&certs.keys[0]).unwrap(),
        &validation,
    )
    .unwrap();
    assert_eq!(verified.claims["email"], ADA);
    assert_eq!(verified.claims["email_verified"], true);
    assert_eq!(verified.claims["given_name"], "Ada");

    // The authentication service reads the same identity without verifying.
    let identity = oauth.parse_google_id_token(&tokens.id_token).unwrap();
    assert_eq!(identity.email, ADA);
    assert_eq!(verified.claims["sub"], identity.sub.as_str());

    // Userinfo, which FusionAuth reads, names the same user.
    let userinfo: serde_json::Value = reqwest::Client::new()
        .get(emulator.userinfo_url())
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(userinfo["sub"], identity.sub.as_str());
    assert_eq!(userinfo["email"], ADA);

    // The access token opens Ada's mailbox, and the refresh token mints more.
    let profile = client(&emulator)
        .get_profile(&tokens.access_token)
        .await
        .unwrap();
    assert_eq!(profile.email_address, ADA);
    let refreshed = oauth
        .refresh_google_token(&tokens.refresh_token)
        .await
        .unwrap();
    assert_eq!(
        oauth
            .parse_google_id_token(&refreshed.id_token)
            .unwrap()
            .sub,
        identity.sub
    );

    // A code works once.
    let again = oauth
        .exchange_google_code_for_tokens(&callback["code"], REDIRECT_URI)
        .await
        .unwrap_err();
    assert!(format!("{again:?}").contains("invalid_grant"), "{again:?}");

    let authorize_calls = emulator
        .requests()
        .iter()
        .filter(|request| request.route == Some(Route::OauthAuthorize))
        .count();
    assert_eq!(authorize_calls, 2);
}

#[tokio::test]
async fn an_unchecked_scope_is_left_out_of_a_new_grant() {
    let emulator = two_mailboxes().await;
    let oauth = oauth_client(&emulator);
    let request = authorization_request(&format!("openid email {GMAIL_SCOPE} {CONTACTS_SCOPE}"));

    // The seeded grant already holds every scope; revoking it makes the next
    // consent start from nothing, as Google's revocation does.
    oauth
        .revoke_google_grant("refresh-ada@example.com")
        .await
        .unwrap();

    let callback = submit(
        &emulator,
        &request,
        &[("user", ADA), ("granted", CONTACTS_SCOPE)],
    )
    .await;
    let tokens = oauth
        .exchange_google_code_for_tokens(&callback["code"], REDIRECT_URI)
        .await
        .unwrap();

    let granted: Vec<&str> = tokens.scope.split(' ').collect();
    assert_eq!(
        granted,
        [
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            CONTACTS_SCOPE
        ]
    );
    // The revoked grant's refresh token stays dead; the new grant has its own.
    assert_ne!(tokens.refresh_token, "refresh-ada@example.com");
    oauth
        .refresh_google_token("refresh-ada@example.com")
        .await
        .unwrap_err();
    oauth
        .refresh_google_token(&tokens.refresh_token)
        .await
        .unwrap();
}

#[tokio::test]
async fn cancelling_returns_access_denied_and_a_code_is_bound_to_its_redirect() {
    let emulator = two_mailboxes().await;
    let request = authorization_request("openid email");

    let cancelled = submit(&emulator, &request, &[("cancel", "1")]).await;
    assert_eq!(cancelled["error"], "access_denied");
    assert_eq!(cancelled["state"], "signed-state");
    assert!(!cancelled.contains_key("code"));

    let callback = submit(&emulator, &request, &[("user", BOB)]).await;
    let refused = oauth_client(&emulator)
        .exchange_google_code_for_tokens(&callback["code"], "http://localhost:8080/elsewhere")
        .await
        .unwrap_err();
    assert!(
        format!("{refused:?}").contains("redirect_uri_mismatch"),
        "{refused:?}"
    );
}

#[tokio::test]
async fn a_request_google_would_refuse_shows_an_error_instead_of_the_chooser() {
    let emulator = two_mailboxes().await;
    let mut request = authorization_request("openid email");
    request.retain(|(name, _)| *name != "redirect_uri");

    let page = browser()
        .get(emulator.authorization_url())
        .query(&request)
        .send()
        .await
        .unwrap();

    assert_eq!(page.status().as_u16(), 400);
    let html = page.text().await.unwrap();
    assert!(html.contains("Missing required parameter: redirect_uri"));
}

#[tokio::test]
async fn a_code_survives_a_failed_exchange_and_can_be_retried() {
    let emulator = GmailEmulator::start(Seed::with_mailboxes([ADA]))
        .await
        .unwrap();
    let request = authorization_request(&format!("openid {GMAIL_SCOPE}"));
    let callback = submit(
        &emulator,
        &request,
        &[("user", ADA), ("granted", GMAIL_SCOPE)],
    )
    .await;
    emulator.inject_fault(Fault {
        route: Some(Route::OauthToken),
        error: Some(FaultError::Unavailable),
        times: Some(1),
        ..Fault::default()
    });

    let oauth = oauth_client(&emulator);
    oauth
        .exchange_google_code_for_tokens(&callback["code"], REDIRECT_URI)
        .await
        .unwrap_err();
    let tokens = oauth
        .exchange_google_code_for_tokens(&callback["code"], REDIRECT_URI)
        .await
        .unwrap();
    assert!(tokens.scope.contains(GMAIL_SCOPE));
}
