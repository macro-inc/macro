//! In-memory doubles for the broker's ports, shared by the domain and inbound
//! tests.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::SystemTime,
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

use crate::domain::{
    models::{
        AccessToken, AuthorizeRequest, CallbackRequest, ClientRegistrationRequest,
        IssuedAuthorizationCode, PendingAuthorization, RefreshToken, RegisteredClient,
        UpstreamTokens,
    },
    ports::{
        BoundClientIdFuture, ClientRegistrationStore, OAuthProvider, RefreshTokenBindingStore,
        RegisteredClientFuture, StoreWriteFuture, UpstreamTokensFuture,
    },
    redirect_uri::RedirectUriPolicy,
    service::{
        InflightAuthStore, McpAuthProxyService, McpAuthProxyServiceDeps, McpAuthProxyServiceImpl,
    },
};

/// Access token the fake upstream provider returns for a code exchange.
pub const UPSTREAM_ACCESS_TOKEN: &str = "upstream-access-token";
/// Refresh token the fake upstream provider returns for a code exchange.
pub const UPSTREAM_REFRESH_TOKEN: &str = "upstream-refresh-token";
/// PKCE verifier belonging to the legitimate client.
pub const VICTIM_CODE_VERIFIER: &str = "victim-code-verifier-that-is-long-enough";
/// PKCE verifier an attacker generates for a crafted authorize request.
pub const ATTACKER_CODE_VERIFIER: &str = "attacker-code-verifier-that-is-long-enough";
/// Loopback callback of a native MCP client.
pub const LOOPBACK_REDIRECT_URI: &str = "http://127.0.0.1:51000/oauth/callback";
/// Callback of a browser-based MCP client on a trusted host.
pub const TRUSTED_REDIRECT_URI: &str = "https://claude.ai/api/mcp/auth_callback";
/// Callback under an attacker's control.
pub const ATTACKER_REDIRECT_URI: &str = "https://attacker.example/steal";
/// Access token the fake upstream provider returns for a refresh.
pub const REFRESHED_ACCESS_TOKEN: &str = "refreshed-access-token";
/// Upstream access token lifetime the fake provider reports, matching the one
/// hour JWT FusionAuth issues.
pub const UPSTREAM_EXPIRES_IN: u64 = 3600;

/// Computes the S256 challenge for a PKCE verifier.
pub fn code_challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// In-memory stand-in for the Redis handshake store.
#[derive(Default)]
pub struct FakeInflightAuth {
    pending: Mutex<HashMap<String, PendingAuthorization>>,
    issued: Mutex<HashMap<String, IssuedAuthorizationCode>>,
}

impl FakeInflightAuth {
    /// Returns the session id of the only pending flow, panicking unless there
    /// is exactly one.
    pub fn only_pending_session_id(&self) -> String {
        let pending = self.pending.lock().expect("pending lock");
        assert_eq!(pending.len(), 1, "expected exactly one pending session");
        pending.keys().next().expect("pending session").clone()
    }

    /// Returns whether any authorization flow is pending.
    pub fn has_pending(&self) -> bool {
        !self.pending.lock().expect("pending lock").is_empty()
    }

    /// Returns whether a broker code is still redeemable.
    pub fn holds_issued_code(&self, code: &str) -> bool {
        self.issued.lock().expect("issued lock").contains_key(code)
    }

    /// Returns the recorded upstream expiry of the only issued code, panicking
    /// unless there is exactly one.
    pub fn only_issued_expiry(&self) -> Option<SystemTime> {
        let issued = self.issued.lock().expect("issued lock");
        assert_eq!(issued.len(), 1, "expected exactly one issued code");
        issued
            .values()
            .next()
            .expect("issued code")
            .access_token_expires_at
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
            .expect("pending lock")
            .insert(session_id.to_owned(), pending);
        Ok(())
    }

    async fn take_pending(&self, session_id: &str) -> anyhow::Result<Option<PendingAuthorization>> {
        Ok(self
            .pending
            .lock()
            .expect("pending lock")
            .remove(session_id))
    }

    async fn insert_issued(
        &self,
        code: &str,
        issued: IssuedAuthorizationCode,
    ) -> anyhow::Result<()> {
        self.issued
            .lock()
            .expect("issued lock")
            .insert(code.to_owned(), issued);
        Ok(())
    }

    async fn take_issued(&self, code: &str) -> anyhow::Result<Option<IssuedAuthorizationCode>> {
        Ok(self.issued.lock().expect("issued lock").remove(code))
    }

    async fn cleanup_expired(&self) -> anyhow::Result<()> {
        Ok(())
    }
}

/// In-memory stand-in for the Redis client registry.
#[derive(Default)]
pub struct FakeClientRegistry {
    clients: Mutex<HashMap<String, RegisteredClient>>,
    refresh_bindings: Mutex<HashMap<String, String>>,
}

impl ClientRegistrationStore for FakeClientRegistry {
    fn insert_client<'a>(&'a self, client: &'a RegisteredClient) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.clients
                .lock()
                .expect("clients lock")
                .insert(client.client_id.clone(), client.clone());
            Ok(())
        })
    }

    fn find_client<'a>(&'a self, client_id: &'a str) -> RegisteredClientFuture<'a> {
        Box::pin(async move {
            Ok(self
                .clients
                .lock()
                .expect("clients lock")
                .get(client_id)
                .cloned())
        })
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
                .expect("bindings lock")
                .insert(refresh_token_digest.to_owned(), client_id.to_owned());
            Ok(())
        })
    }

    fn bound_client<'a>(&'a self, refresh_token_digest: &'a str) -> BoundClientIdFuture<'a> {
        Box::pin(async move {
            Ok(self
                .refresh_bindings
                .lock()
                .expect("bindings lock")
                .get(refresh_token_digest)
                .cloned())
        })
    }

    fn unbind<'a>(&'a self, refresh_token_digest: &'a str) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.refresh_bindings
                .lock()
                .expect("bindings lock")
                .remove(refresh_token_digest);
            Ok(())
        })
    }
}

/// Upstream provider that hands back fixed tokens, standing in for FusionAuth.
pub struct FakeOAuthProvider {
    rotated_refresh_token: Option<String>,
}

impl FakeOAuthProvider {
    /// A provider whose refresh grant returns the presented refresh token
    /// again, as FusionAuth does on a sliding window.
    pub fn new() -> Self {
        Self {
            rotated_refresh_token: None,
        }
    }

    /// A provider whose refresh grant issues a new refresh token.
    pub fn rotating(rotated_refresh_token: &str) -> Self {
        Self {
            rotated_refresh_token: Some(rotated_refresh_token.to_owned()),
        }
    }
}

impl OAuthProvider for FakeOAuthProvider {
    fn construct_authorize_url(&self, state: &str) -> anyhow::Result<String> {
        Ok(format!("https://upstream.example/authorize?state={state}"))
    }

    fn exchange_authorization_code<'a>(&'a self, _code: &'a str) -> UpstreamTokensFuture<'a> {
        Box::pin(async move {
            Ok(UpstreamTokens {
                access_token: AccessToken::from(UPSTREAM_ACCESS_TOKEN),
                refresh_token: RefreshToken::from(UPSTREAM_REFRESH_TOKEN),
                expires_in: UPSTREAM_EXPIRES_IN,
            })
        })
    }

    fn refresh_access_token<'a>(
        &'a self,
        refresh_token: &'a RefreshToken,
    ) -> UpstreamTokensFuture<'a> {
        Box::pin(async move {
            let next = self
                .rotated_refresh_token
                .clone()
                .unwrap_or_else(|| refresh_token.as_str().to_owned());
            Ok(UpstreamTokens {
                access_token: AccessToken::from(REFRESHED_ACCESS_TOKEN),
                refresh_token: RefreshToken::from(next),
                expires_in: UPSTREAM_EXPIRES_IN,
            })
        })
    }
}

/// A broker service wired to in-memory stores, trusting only `claude.ai` for
/// `https` redirect URIs.
pub struct Harness {
    /// The service under test.
    pub service: McpAuthProxyServiceImpl<FakeInflightAuth>,
    /// The handshake store the service was built with.
    pub inflight: Arc<FakeInflightAuth>,
    /// The client registry the service was built with.
    pub registry: Arc<FakeClientRegistry>,
}

impl Harness {
    /// Builds a harness whose upstream refresh grant does not rotate.
    pub fn new() -> Self {
        Self::with_provider(FakeOAuthProvider::new())
    }

    /// Builds a harness over a specific fake upstream provider.
    pub fn with_provider(provider: FakeOAuthProvider) -> Self {
        let inflight = Arc::new(FakeInflightAuth::default());
        let registry = Arc::new(FakeClientRegistry::default());
        let service = McpAuthProxyServiceImpl::new(McpAuthProxyServiceDeps {
            public_url: "https://mcp.macro.com".to_owned(),
            redirect_uri_policy: RedirectUriPolicy::new(["claude.ai"]),
            inflight_auth: Arc::clone(&inflight),
            client_registrations: Arc::clone(&registry) as Arc<dyn ClientRegistrationStore>,
            refresh_token_bindings: Arc::clone(&registry) as Arc<dyn RefreshTokenBindingStore>,
            oauth_provider: Arc::new(provider),
        });

        Self {
            service,
            inflight,
            registry,
        }
    }

    /// Registers a client and returns its assigned id.
    pub async fn register(&self, redirect_uris: &[&str]) -> String {
        self.service
            .register_client(ClientRegistrationRequest {
                client_name: Some("test-client".to_owned()),
                redirect_uris: redirect_uris.iter().map(|uri| (*uri).to_owned()).collect(),
            })
            .await
            .expect("registration should succeed")
            .client_id
    }

    /// Builds a well-formed authorize request.
    pub fn authorize_request(
        &self,
        client_id: &str,
        redirect_uri: &str,
        code_challenge: &str,
    ) -> AuthorizeRequest {
        AuthorizeRequest {
            response_type: "code".to_owned(),
            client_id: client_id.to_owned(),
            redirect_uri: redirect_uri.to_owned(),
            state: "client-state".to_owned(),
            code_challenge: code_challenge.to_owned(),
            code_challenge_method: "S256".to_owned(),
            scope: None,
        }
    }

    /// Drives authorize plus the upstream callback and returns the broker code
    /// delivered to the client's redirect URI.
    pub async fn complete_flow_to_code(
        &self,
        client_id: &str,
        redirect_uri: &str,
        code_verifier: &str,
    ) -> String {
        self.service
            .start_authorization(self.authorize_request(
                client_id,
                redirect_uri,
                &code_challenge_for(code_verifier),
            ))
            .await
            .expect("authorize should succeed");

        let session_id = self.inflight.only_pending_session_id();
        let redirect = self
            .service
            .complete_callback(CallbackRequest {
                code: Some("upstream-code".to_owned()),
                state: Some(session_id),
                error: None,
                error_description: None,
            })
            .await
            .expect("callback should succeed");

        query_param(&redirect, "code").expect("redirect carries a code")
    }
}

/// Reads a query parameter from a redirect URL.
pub fn query_param(url: &str, name: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    let prefix = format!("{name}=");
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix(&prefix))
        .map(str::to_owned)
}
