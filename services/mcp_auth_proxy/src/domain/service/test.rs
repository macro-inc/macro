use super::*;

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, SystemTime},
};

use crate::domain::{
    models::{AccessToken, RefreshToken, UpstreamTokens},
    ports::{BoundClientIdFuture, RegisteredClientFuture, StoreWriteFuture},
};

/// Upstream access token lifetime FusionAuth reports for a one hour JWT.
const UPSTREAM_EXPIRES_IN: u64 = 3600;
const CODE_VERIFIER: &str = "test-code-verifier";
const REDIRECT_URI: &str = "http://localhost:41234/callback";
const CLIENT_ID: &str = "test-client-id";

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

#[derive(Default)]
struct FakeClientRegistry {
    clients: Mutex<HashMap<String, RegisteredClient>>,
    refresh_bindings: Mutex<HashMap<String, String>>,
}

impl FakeClientRegistry {
    /// A registry holding `CLIENT_ID`, registered against `REDIRECT_URI`.
    fn with_test_client() -> Self {
        let registry = Self::default();
        registry.clients.lock().unwrap().insert(
            CLIENT_ID.to_owned(),
            RegisteredClient {
                client_id: CLIENT_ID.to_owned(),
                client_name: "test-client".to_owned(),
                redirect_uris: vec![REDIRECT_URI.to_owned()],
            },
        );
        registry
    }

    fn bind_now(&self, refresh_token: &RefreshToken, client_id: &str) {
        self.refresh_bindings
            .lock()
            .unwrap()
            .insert(refresh_token_digest(refresh_token), client_id.to_owned());
    }
}

impl ClientRegistrationStore for FakeClientRegistry {
    fn insert_client<'a>(&'a self, client: &'a RegisteredClient) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.clients
                .lock()
                .unwrap()
                .insert(client.client_id.clone(), client.clone());
            Ok(())
        })
    }

    fn find_client<'a>(&'a self, client_id: &'a str) -> RegisteredClientFuture<'a> {
        Box::pin(async move { Ok(self.clients.lock().unwrap().get(client_id).cloned()) })
    }
}

impl RefreshTokenBindingStore for FakeClientRegistry {
    fn bind<'a>(
        &'a self,
        refresh_token_digest: &'a str,
        client_id: &'a str,
    ) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.refresh_bindings
                .lock()
                .unwrap()
                .insert(refresh_token_digest.to_owned(), client_id.to_owned());
            Ok(())
        })
    }

    fn bound_client<'a>(&'a self, refresh_token_digest: &'a str) -> BoundClientIdFuture<'a> {
        Box::pin(async move {
            Ok(self
                .refresh_bindings
                .lock()
                .unwrap()
                .get(refresh_token_digest)
                .cloned())
        })
    }

    fn unbind<'a>(&'a self, refresh_token_digest: &'a str) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.refresh_bindings
                .lock()
                .unwrap()
                .remove(refresh_token_digest);
            Ok(())
        })
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

fn service_with(
    store: Arc<FakeInflightAuth>,
    registry: Arc<FakeClientRegistry>,
) -> McpAuthProxyServiceImpl<FakeInflightAuth> {
    McpAuthProxyServiceImpl::new(McpAuthProxyServiceDeps {
        public_url: "https://mcp.example.com".to_owned(),
        redirect_uri_policy: RedirectUriPolicy::new(["claude.ai"]),
        inflight_auth: store,
        client_registrations: registry.clone() as Arc<dyn ClientRegistrationStore>,
        refresh_token_bindings: registry as Arc<dyn RefreshTokenBindingStore>,
        oauth_provider: Arc::new(FakeOAuthProvider {
            expires_in: UPSTREAM_EXPIRES_IN,
        }),
    })
}

fn service(store: FakeInflightAuth) -> McpAuthProxyServiceImpl<FakeInflightAuth> {
    service_with(
        Arc::new(store),
        Arc::new(FakeClientRegistry::with_test_client()),
    )
}

fn issued_code(access_token_expires_at: Option<SystemTime>) -> IssuedAuthorizationCode {
    IssuedAuthorizationCode {
        client_id: CLIENT_ID.to_owned(),
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
        client_id: Some(CLIENT_ID.to_owned()),
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
    let registry = Arc::new(FakeClientRegistry::with_test_client());
    let refresh_token = RefreshToken::from("upstream-refresh");
    registry.bind_now(&refresh_token, CLIENT_ID);
    let service = service_with(Arc::new(FakeInflightAuth::default()), registry);

    let response = service
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            code_verifier: None,
            refresh_token: Some(refresh_token),
            redirect_uri: None,
            client_id: Some(CLIENT_ID.to_owned()),
        })
        .await
        .expect("refresh exchange should succeed");

    assert_eq!(response.expires_in, Some(UPSTREAM_EXPIRES_IN));
    assert_eq!(response.access_token.as_str(), "refreshed-access");
}

#[tokio::test]
async fn callback_records_upstream_expiry_on_the_issued_code() {
    let store = Arc::new(FakeInflightAuth::default());
    let service = service_with(
        Arc::clone(&store),
        Arc::new(FakeClientRegistry::with_test_client()),
    );

    store
        .insert_pending(
            "session-id",
            PendingAuthorization {
                client_id: CLIENT_ID.to_owned(),
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
