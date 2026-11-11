use std::collections::HashMap;
use std::net::SocketAddr;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use fusionauth::FusionAuthClient;
use fusionauth::microsoft::runtime::MicrosoftRuntimeError;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use reqwest::redirect::Policy;
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use super::{ADA, BOB};
use crate::{Options, OutlookEmulator, Route, Seed};

const CLIENT_ID: &str = "0195a000-0000-7000-8000-0000000c11e7";
const REDIRECT_URI: &str = "http://localhost:8080/oauth2/microsoft/callback";
const VERIFIER: &str = "a-pkce-verifier-of-the-linking-attempt";
const NONCE: &str = "a-nonce-of-the-linking-attempt";
const SEED: &str = "mailboxes:\n  - email: ada@example.com\n    name: Ada Example\n  - email: bob@example.com\n    unverified_email_domain: true\n";

async fn start() -> OutlookEmulator {
    OutlookEmulator::start(Seed::parse(SEED).unwrap())
        .await
        .unwrap()
}

/// A browser that stops at each redirect, so a test reads where it leads.
fn browser() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(Policy::none())
        .build()
        .unwrap()
}

/// The authentication service's Microsoft client, pointed at the emulator.
fn microsoft_client(emulator: &OutlookEmulator) -> FusionAuthClient {
    FusionAuthClient::new(
        "fusionauth-api-key".to_string(),
        "fusionauth-client".to_string(),
        "fusionauth-secret".to_string(),
        "http://127.0.0.1:1".to_string(),
        "http://127.0.0.1:1/oauth/redirect".to_string(),
        "google-client".to_string(),
        "google-secret".to_string(),
    )
    .with_microsoft_credentials(
        CLIENT_ID.to_string(),
        "client-secret".to_string(),
        "common".to_string(),
    )
    .with_microsoft_urls(
        emulator.login_url(),
        emulator.login_page_url(),
        emulator.graph_url(),
    )
}

/// The URL the authentication service sends a browser to for an Outlook link.
fn link_url(client: &FusionAuthClient) -> Url {
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(VERIFIER.as_bytes()));
    let url = client
        .construct_bound_microsoft_authorize_url(
            REDIRECT_URI,
            "signed-state",
            &challenge,
            NONCE,
            false,
        )
        .unwrap();
    Url::parse(&url).unwrap()
}

/// Submits a page's form with a choice, and returns the query the browser
/// is sent back to the client with.
async fn submit(page: &Url, choice: (&str, &str)) -> HashMap<String, String> {
    let mut form: Vec<(String, String)> = page.query_pairs().into_owned().collect();
    form.push((choice.0.to_string(), choice.1.to_string()));
    let mut action = page.clone();
    action.set_query(None);
    let response = browser().post(action).form(&form).send().await.unwrap();
    assert_eq!(response.status().as_u16(), 303);

    let location = response.headers()["location"].to_str().unwrap();
    assert!(location.starts_with(REDIRECT_URI), "{location}");
    Url::parse(location)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect()
}

#[tokio::test]
async fn a_person_picks_a_seeded_user_and_the_real_client_links_their_mailbox() {
    let emulator = start().await;
    let client = microsoft_client(&emulator);
    let page = link_url(&client);

    // The page lists the seeded users and the permissions asked for.
    let shown = browser().get(page.clone()).send().await.unwrap();
    assert_eq!(shown.status().as_u16(), 200);
    let html = shown.text().await.unwrap();
    assert!(html.contains("Ada Example") && html.contains(ADA) && html.contains(BOB));
    assert!(html.contains("Mail.ReadWrite") && !html.contains("<code>openid</code>"));

    // Picking Ada sends the browser back with a code and the state.
    let returned = submit(&page, ("user", ADA)).await;
    assert_eq!(returned["state"], "signed-state");

    // The code is exchanged, the ID token verified against the emulator's
    // keys, and the mailbox read from Graph with the access token.
    let tokens = client
        .exchange_bound_microsoft_code(&returned["code"], REDIRECT_URI, VERIFIER)
        .await
        .unwrap();
    let granted: Vec<&str> = tokens.scope.split(' ').collect();
    assert!(granted.contains(&"Mail.ReadWrite") && granted.contains(&"Mail.Send"));
    assert!(!granted.contains(&"offline_access"));
    let identity = client
        .parse_bound_microsoft_id_token(&tokens.id_token, NONCE)
        .await
        .unwrap();
    assert_eq!(identity.email.as_deref(), Some(ADA));
    let mailbox = client
        .microsoft_mailbox_identity(&tokens.access_token)
        .await
        .unwrap();
    assert_eq!(mailbox.mail.as_deref(), Some(ADA));
    assert_eq!(identity.object_id.as_deref(), Some(mailbox.id.as_str()));

    // Refreshing answers a new access token and a further refresh token.
    let refreshed = client
        .refresh_microsoft_tokens(&tokens.refresh_token)
        .await
        .unwrap();
    assert_ne!(refreshed.access_token, tokens.access_token);
    let rotated = refreshed.refresh_token.unwrap();
    assert_ne!(rotated, tokens.refresh_token);
    assert!(client.refresh_microsoft_tokens(&rotated).await.is_ok());

    let routes: Vec<Route> = emulator
        .requests()
        .iter()
        .filter_map(|request| request.route)
        .collect();
    assert_eq!(
        routes,
        [
            Route::OauthAuthorize,
            Route::OauthAuthorize,
            Route::OauthToken,
            Route::OauthDiscovery,
            Route::OauthKeys,
            Route::MeGet,
            Route::OauthToken,
            Route::OauthToken,
        ]
    );
}

#[tokio::test]
async fn a_revoked_grant_stays_dead_and_a_new_consent_starts_another() {
    let emulator = start().await;
    let client = microsoft_client(&emulator);
    let page = link_url(&client);
    let returned = submit(&page, ("user", ADA)).await;
    let first = client
        .exchange_bound_microsoft_code(&returned["code"], REDIRECT_URI, VERIFIER)
        .await
        .unwrap();

    emulator.revoke_grant(ADA).unwrap();
    let refused = client.refresh_microsoft_tokens(&first.refresh_token).await;
    assert!(matches!(
        refused,
        Err(MicrosoftRuntimeError::ReauthorizationRequired)
    ));
    assert!(
        client
            .microsoft_mailbox_identity(&first.access_token)
            .await
            .is_err()
    );

    let returned = submit(&page, ("user", ADA)).await;
    let second = client
        .exchange_bound_microsoft_code(&returned["code"], REDIRECT_URI, VERIFIER)
        .await
        .unwrap();
    assert!(
        client
            .refresh_microsoft_tokens(&second.refresh_token)
            .await
            .is_ok()
    );
    let still_refused = client.refresh_microsoft_tokens(&first.refresh_token).await;
    assert!(matches!(
        still_refused,
        Err(MicrosoftRuntimeError::ReauthorizationRequired)
    ));
}

#[tokio::test]
async fn a_code_is_redeemed_once_by_the_attempt_it_was_issued_to() {
    let emulator = start().await;
    let client = microsoft_client(&emulator);
    let page = link_url(&client);

    let returned = submit(&page, ("user", ADA)).await;
    let wrong_verifier = client
        .exchange_bound_microsoft_code(&returned["code"], REDIRECT_URI, "another-verifier")
        .await;
    assert!(wrong_verifier.is_err());

    let returned = submit(&page, ("user", ADA)).await;
    let wrong_redirect = client
        .exchange_bound_microsoft_code(&returned["code"], "http://localhost:1/other", VERIFIER)
        .await;
    assert!(wrong_redirect.is_err());

    let returned = submit(&page, ("user", ADA)).await;
    let code = &returned["code"];
    assert!(
        client
            .exchange_bound_microsoft_code(code, REDIRECT_URI, VERIFIER)
            .await
            .is_ok()
    );
    assert!(
        client
            .exchange_bound_microsoft_code(code, REDIRECT_URI, VERIFIER)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn declining_and_needing_an_administrator_return_what_entra_returns() {
    let emulator = start().await;
    let client = microsoft_client(&emulator);
    let page = link_url(&client);

    let cancelled = submit(&page, ("cancel", "1")).await;
    assert_eq!(cancelled["error"], "access_denied");
    assert!(cancelled["error_description"].starts_with("AADSTS65004"));
    assert_eq!(cancelled["state"], "signed-state");

    let needs_admin = submit(&page, ("admin_approval", "1")).await;
    assert_eq!(needs_admin["error"], "access_denied");
    assert!(needs_admin["error_description"].starts_with("AADSTS65001"));

    // The page an administrator approves the application on.
    let consent_url = client
        .construct_microsoft_admin_consent_url(REDIRECT_URI, "consent-state", true)
        .unwrap();
    let consent_page = Url::parse(&consent_url).unwrap();
    assert!(consent_page.path().starts_with("/organizations/"));
    let shown = browser().get(consent_page.clone()).send().await.unwrap();
    assert!(shown.text().await.unwrap().contains("Calendars.ReadWrite"));
    let approved = submit(&consent_page, ("accept", "1")).await;
    assert_eq!(approved["admin_consent"], "True");
    assert_eq!(approved["state"], "consent-state");
    assert!(uuid::Uuid::parse_str(&approved["tenant"]).is_ok());
    let refused = submit(&consent_page, ("cancel", "1")).await;
    assert_eq!(refused["error"], "access_denied");

    // A request the emulator cannot answer shows an error and goes nowhere.
    let mut implicit = page.clone();
    implicit.set_query(Some("client_id=c&redirect_uri=http://localhost/&scope=openid&response_type=token"));
    let shown = browser().get(implicit).send().await.unwrap();
    assert_eq!(shown.status().as_u16(), 400);
}

/// Sign in with Microsoft as FusionAuth's OpenID Connect identity provider
/// does it: endpoints from the discovery document, the client in a Basic
/// header, and the ID token verified with the published keys.
#[tokio::test]
async fn an_openid_connect_client_signs_in_from_the_discovery_document() {
    let options = Options {
        browser_url: Some("http://localhost:28481".to_string()),
        ..Options::default()
    };
    let address = SocketAddr::from(([127, 0, 0, 1], 0));
    let emulator = OutlookEmulator::start_on(address, Seed::parse(SEED).unwrap(), options)
        .await
        .unwrap();
    let http = browser();
    let json = |url: String| {
        let http = http.clone();
        async move { http.get(url).send().await.unwrap().json::<Value>().await.unwrap() }
    };

    let discovery = json(format!(
        "{}common/v2.0/.well-known/openid-configuration",
        emulator.login_url()
    ))
    .await;
    assert_eq!(
        discovery["issuer"],
        "https://login.microsoftonline.com/{tenantid}/v2.0"
    );
    // Only the page is where a browser reaches the emulator.
    assert_eq!(
        discovery["authorization_endpoint"],
        "http://localhost:28481/common/oauth2/v2.0/authorize"
    );
    let token_endpoint = discovery["token_endpoint"].as_str().unwrap();
    assert!(token_endpoint.starts_with(&emulator.base_url()));

    let mut tokens = HashMap::new();
    for user in [ADA, BOB] {
        let request = [
            ("client_id", CLIENT_ID),
            ("redirect_uri", REDIRECT_URI),
            ("response_type", "code"),
            ("scope", "openid email profile offline_access"),
            ("state", "fusionauth-state"),
            ("prompt", "select_account"),
            ("user", user),
        ];
        let authorize = format!("{}/common/oauth2/v2.0/authorize", emulator.base_url());
        let response = http.post(authorize).form(&request).send().await.unwrap();
        let location = Url::parse(response.headers()["location"].to_str().unwrap()).unwrap();
        let code = location
            .query_pairs()
            .find(|(name, _)| name == "code")
            .unwrap()
            .1
            .into_owned();
        let exchange = [
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", REDIRECT_URI),
        ];
        let answered = http
            .post(token_endpoint)
            .basic_auth(CLIENT_ID, Some("client-secret"))
            .form(&exchange)
            .send()
            .await
            .unwrap();
        assert_eq!(answered.status().as_u16(), 200);
        tokens.insert(user, answered.json::<Value>().await.unwrap());
    }

    let keys = json(discovery["jwks_uri"].as_str().unwrap().to_string()).await;
    let keys: JwkSet = serde_json::from_value(keys).unwrap();
    let claims = |user: &str| {
        let token = tokens[user]["id_token"].as_str().unwrap();
        let kid = jsonwebtoken::decode_header(token).unwrap().kid.unwrap();
        let key = DecodingKey::from_jwk(keys.find(&kid).unwrap()).unwrap();
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[CLIENT_ID]);
        jsonwebtoken::decode::<Value>(token, &key, &validation)
            .unwrap()
            .claims
    };

    let ada = claims(ADA);
    assert_eq!(ada["email"], ADA);
    assert_eq!(ada["name"], "Ada Example");
    assert_eq!(ada["xms_edov"], true);
    let tenant = ada["tid"].as_str().unwrap();
    assert_eq!(
        ada["iss"],
        format!("https://login.microsoftonline.com/{tenant}/v2.0")
    );
    // Microsoft has not verified Bob's domain, so his token does not say so.
    let bob = claims(BOB);
    assert_eq!(bob["email"], BOB);
    assert!(bob.get("xms_edov").is_none());

    let userinfo = http
        .get(discovery["userinfo_endpoint"].as_str().unwrap())
        .bearer_auth(tokens[ADA]["access_token"].as_str().unwrap())
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(userinfo["sub"], ada["sub"]);
    assert_eq!(userinfo["email"], ADA);
    assert_eq!(userinfo["given_name"], "Ada");
    assert_eq!(userinfo["family_name"], "Example");
}
