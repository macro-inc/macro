use super::*;

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, SystemTime},
};

use crate::domain::models::{AccessToken, RefreshToken, UpstreamTokens};

/// Upstream access token lifetime FusionAuth reports for a one hour JWT.
const UPSTREAM_EXPIRES_IN: u64 = 3600;
const CODE_VERIFIER: &str = "test-code-verifier";
const REDIRECT_URI: &str = "http://localhost:41234/callback";

fn code_challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[derive(Default)]
struct FakeInflightAuth {
    pending: Mutex<HashMap<String, PendingAuthorization>>,
    issued: Mutex<HashMap<String, IssuedAuthorizationCode>>,
}

impl FakeInflightAuth {
    fn with_issued(code: &str, issued: IssuedAuthorizationCode) -> Self {
        let store = Self::default();
        store.issued.lock().unwrap().insert(code.to_owned(), issued);
        store
    }
}

impl InflightAuthStore for FakeInflightAuth {
    async fn insert_pending(
        &self,
        session_id: &str,
        pending: PendingAuthorization,
    ) -> anyhow::Result<()> {
        self.pending
            .lock()
            .unwrap()
            .insert(session_id.to_owned(), pending);
        Ok(())
    }

    async fn take_pending(&self, session_id: &str) -> anyhow::Result<Option<PendingAuthorization>> {
        Ok(self.pending.lock().unwrap().remove(session_id))
    }

    async fn insert_issued(
        &self,
        code: &str,
        issued: IssuedAuthorizationCode,
    ) -> anyhow::Result<()> {
        self.issued.lock().unwrap().insert(code.to_owned(), issued);
        Ok(())
    }

    async fn take_issued(&self, code: &str) -> anyhow::Result<Option<IssuedAuthorizationCode>> {
        Ok(self.issued.lock().unwrap().remove(code))
    }

    async fn cleanup_expired(&self) -> anyhow::Result<()> {
        Ok(())
    }
}

struct FakeOAuthProvider {
    expires_in: u64,
}

impl OAuthProvider for FakeOAuthProvider {
    fn construct_authorize_url(&self, state: &str) -> anyhow::Result<String> {
        Ok(format!(
            "https://upstream.example.com/authorize?state={state}"
        ))
    }

    fn exchange_authorization_code<'a>(
        &'a self,
        _code: &'a str,
    ) -> crate::domain::ports::UpstreamTokensFuture<'a> {
        Box::pin(async move {
            Ok(UpstreamTokens {
                access_token: AccessToken::from("upstream-access"),
                refresh_token: RefreshToken::from("upstream-refresh"),
                expires_in: self.expires_in,
            })
        })
    }

    fn refresh_access_token<'a>(
        &'a self,
        _refresh_token: &'a RefreshToken,
    ) -> crate::domain::ports::UpstreamTokensFuture<'a> {
        Box::pin(async move {
            Ok(UpstreamTokens {
                access_token: AccessToken::from("refreshed-access"),
                refresh_token: RefreshToken::from("refreshed-refresh"),
                expires_in: self.expires_in,
            })
        })
    }
}

fn service(store: FakeInflightAuth) -> McpAuthProxyServiceImpl<FakeInflightAuth> {
    McpAuthProxyServiceImpl::new(
        "https://mcp.example.com".to_owned(),
        Arc::new(store),
        Arc::new(FakeOAuthProvider {
            expires_in: UPSTREAM_EXPIRES_IN,
        }),
    )
}

fn issued_code(access_token_expires_at: Option<SystemTime>) -> IssuedAuthorizationCode {
    IssuedAuthorizationCode {
        access_token: AccessToken::from("upstream-access"),
        refresh_token: RefreshToken::from("upstream-refresh"),
        code_challenge: code_challenge_for(CODE_VERIFIER),
        redirect_uri: REDIRECT_URI.to_owned(),
        access_token_expires_at,
    }
}

fn authorization_code_request(code: &str) -> TokenRequest {
    TokenRequest {
        grant_type: "authorization_code".to_owned(),
        code: Some(code.to_owned()),
        code_verifier: Some(CODE_VERIFIER.to_owned()),
        refresh_token: None,
        redirect_uri: Some(REDIRECT_URI.to_owned()),
        client_id: None,
    }
}

#[tokio::test]
async fn authorization_code_exchange_returns_remaining_lifetime() {
    // Issued five minutes ago, so the client should be told what is left rather
    // than the full upstream lifetime.
    let expires_at = SystemTime::now() + Duration::from_secs(UPSTREAM_EXPIRES_IN - 300);
    let service = service(FakeInflightAuth::with_issued(
        "broker-code",
        issued_code(Some(expires_at)),
    ));

    let response = service
        .exchange_token(authorization_code_request("broker-code"))
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
    let service = service(FakeInflightAuth::with_issued(
        "broker-code",
        issued_code(Some(
            SystemTime::now() + Duration::from_secs(UPSTREAM_EXPIRES_IN),
        )),
    ));

    let response = service
        .exchange_token(authorization_code_request("broker-code"))
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
    let service = service(FakeInflightAuth::with_issued(
        "broker-code",
        issued_code(None),
    ));

    let response = service
        .exchange_token(authorization_code_request("broker-code"))
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
    let service = service(FakeInflightAuth::with_issued(
        "broker-code",
        issued_code(Some(SystemTime::now() - Duration::from_secs(60))),
    ));

    let response = service
        .exchange_token(authorization_code_request("broker-code"))
        .await
        .expect("token exchange should succeed");

    assert_eq!(response.expires_in, Some(0));
}

#[tokio::test]
async fn refresh_grant_returns_upstream_lifetime() {
    let service = service(FakeInflightAuth::default());

    let response = service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(RefreshToken::from("upstream-refresh")),
            redirect_uri: None,
            client_id: None,
        })
        .await
        .expect("refresh exchange should succeed");

    assert_eq!(response.expires_in, Some(UPSTREAM_EXPIRES_IN));
    assert_eq!(response.access_token.as_str(), "refreshed-access");
}

#[tokio::test]
async fn callback_records_upstream_expiry_on_the_issued_code() {
    let store = Arc::new(FakeInflightAuth::default());
    let service = McpAuthProxyServiceImpl::new(
        "https://mcp.example.com".to_owned(),
        Arc::clone(&store),
        Arc::new(FakeOAuthProvider {
            expires_in: UPSTREAM_EXPIRES_IN,
        }),
    );

    store
        .insert_pending(
            "session-id",
            PendingAuthorization {
                code_challenge: code_challenge_for(CODE_VERIFIER),
                client_state: "client-state".to_owned(),
                client_redirect_uri: REDIRECT_URI.to_owned(),
            },
        )
        .await
        .expect("pending insert should succeed");

    service
        .complete_callback(CallbackRequest {
            code: Some("upstream-code".to_owned()),
            state: Some("session-id".to_owned()),
            error: None,
            error_description: None,
        })
        .await
        .expect("callback should succeed");

    let issued = store.issued.lock().unwrap();
    let (_, stored) = issued.iter().next().expect("a code should be issued");
    let expires_at = stored
        .access_token_expires_at
        .expect("issued code should record the upstream expiry");
    let remaining = expires_at
        .duration_since(SystemTime::now())
        .expect("expiry should be in the future")
        .as_secs();
    assert!(
        (UPSTREAM_EXPIRES_IN - 2..=UPSTREAM_EXPIRES_IN).contains(&remaining),
        "expected roughly {UPSTREAM_EXPIRES_IN} seconds remaining, got {remaining}"
    );
}
