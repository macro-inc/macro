//! In-memory doubles for the broker's ports, shared by the domain and inbound
//! tests.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

use crate::domain::{
    browser_binding::BrowserBinding,
    models::{
        AccessToken, AuthorizeRequest, CallbackRequest, ClientRegistrationRequest,
        EmailCodeRequest, IssuedAuthorizationCode, PendingAuthorization, RefreshToken,
        RefreshTokenBinding, RegisteredClient, UpstreamLogin, UpstreamTokens, UserConsent,
    },
    ports::{
        ClientRegistrationStore, EmailCodeError, EmailCodeProvider, EmailCodeRequestFuture,
        EmailCodeTokensFuture, GrantRevokedFuture, MacroApiTokenMinter, MintedAccessToken,
        MintedAccessTokenFuture, OAuthProvider, RefreshTokenBindingFuture,
        RefreshTokenBindingStore, RegisteredClientFuture, StoreWriteFuture, UpstreamGrantError,
        UpstreamRevocationFuture, UpstreamTokensFuture,
    },
    redirect_uri::RedirectUriPolicy,
    resource::McpResources,
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
/// An `https` callback on a host outside the trusted list, such as a
/// self-hosted MCP gateway's.
pub const GATEWAY_REDIRECT_URI: &str = "https://gateway.example/oauth/callback";
/// Access token the fake upstream provider returns for a refresh.
pub const REFRESHED_ACCESS_TOKEN: &str = "refreshed-access-token";
/// Upstream access token lifetime the fake provider reports, matching the one
/// hour JWT FusionAuth issues.
pub const UPSTREAM_EXPIRES_IN: u64 = 3600;
/// An address the fake email provider sends codes to.
pub const EMAIL_ADDRESS: &str = "user@example.com";
/// An address whose domain the fake email provider routes to single sign-on.
pub const SSO_EMAIL_ADDRESS: &str = "user@sso.example";
/// The only code the fake email provider accepts.
pub const EMAIL_CODE: &str = "123456";
/// The harness's public MCP, as its metadata advertises it.
pub const HARNESS_RESOURCE: &str = "https://mcp.macro.com/mcp";
/// The ChatGPT MCP server, which gets Macro API tokens.
pub const CHATGPT_RESOURCE: &str = "https://mcp-chatgpt.macro.com/mcp";

/// The longest token the fake minter signs, like the harness's signer cap.
pub const MINTED_LIFETIME_CAP_SECONDS: u64 = 900;

/// Minter that spells out what it signed, standing in for the harness's Macro
/// API token signer, and caps lifetimes as it does.
pub struct FakeMacroApiTokens;

impl MacroApiTokenMinter for FakeMacroApiTokens {
    fn mint<'a>(
        &'a self,
        upstream: &'a AccessToken,
        client_name: Option<&'a str>,
        lifetime: Duration,
    ) -> MintedAccessTokenFuture<'a> {
        Box::pin(async move {
            let seconds = lifetime.as_secs().min(MINTED_LIFETIME_CAP_SECONDS);
            Ok(MintedAccessToken {
                token: AccessToken::from(format!(
                    "macro-api-token for {} via {} for {seconds}s",
                    upstream.as_str(),
                    client_name.unwrap_or("no client"),
                )),
                lifetime: Duration::from_secs(seconds),
            })
        })
    }
}

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

    /// Returns whether any broker code has been issued.
    pub fn holds_any_issued_code(&self) -> bool {
        !self.issued.lock().expect("issued lock").is_empty()
    }

    /// Returns the recorded upstream expiry of the only issued code, panicking
    /// unless there is exactly one.
    pub fn only_issued_expiry(&self) -> SystemTime {
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

    async fn find_pending(&self, session_id: &str) -> anyhow::Result<Option<PendingAuthorization>> {
        Ok(self
            .pending
            .lock()
            .expect("pending lock")
            .get(session_id)
            .cloned())
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
    refresh_bindings: Mutex<HashMap<String, RefreshTokenBinding>>,
    revoked_grants: Mutex<HashSet<String>>,
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
        binding: &'a RefreshTokenBinding,
    ) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.refresh_bindings
                .lock()
                .expect("bindings lock")
                .insert(refresh_token_digest.to_owned(), binding.clone());
            Ok(())
        })
    }

    fn binding<'a>(&'a self, refresh_token_digest: &'a str) -> RefreshTokenBindingFuture<'a> {
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

    fn revoke_grant<'a>(&'a self, grant_id: &'a str) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.revoked_grants
                .lock()
                .expect("revoked grants lock")
                .insert(grant_id.to_owned());
            Ok(())
        })
    }

    fn is_grant_revoked<'a>(&'a self, grant_id: &'a str) -> GrantRevokedFuture<'a> {
        Box::pin(async move {
            Ok(self
                .revoked_grants
                .lock()
                .expect("revoked grants lock")
                .contains(grant_id))
        })
    }
}

/// Builds the failure a fake upstream grant answers with.
type GrantFailure = Box<dyn Fn() -> UpstreamGrantError + Send + Sync>;

/// Upstream provider that hands back fixed tokens, standing in for FusionAuth.
pub struct FakeOAuthProvider {
    rotated_refresh_token: Option<String>,
    revoked_refresh_tokens: Mutex<HashSet<String>>,
    refresh_failure: Option<GrantFailure>,
    code_exchange_failure: Option<GrantFailure>,
}

impl FakeOAuthProvider {
    /// A provider whose refresh grant returns the presented refresh token
    /// again, as FusionAuth does on a sliding window.
    pub fn new() -> Self {
        Self {
            rotated_refresh_token: None,
            revoked_refresh_tokens: Mutex::default(),
            refresh_failure: None,
            code_exchange_failure: None,
        }
    }

    /// This provider, with every refresh grant failing with `failure()`.
    pub fn failing_refresh(
        mut self,
        failure: impl Fn() -> UpstreamGrantError + Send + Sync + 'static,
    ) -> Self {
        self.refresh_failure = Some(Box::new(failure));
        self
    }

    /// This provider, with every authorization code grant failing with
    /// `failure()`.
    pub fn failing_code_exchange(
        mut self,
        failure: impl Fn() -> UpstreamGrantError + Send + Sync + 'static,
    ) -> Self {
        self.code_exchange_failure = Some(Box::new(failure));
        self
    }

    /// Returns whether the provider was asked to revoke `refresh_token`.
    pub fn revoked(&self, refresh_token: &str) -> bool {
        self.revoked_refresh_tokens
            .lock()
            .expect("revoked refresh tokens lock")
            .contains(refresh_token)
    }

    /// A provider whose refresh grant issues a new refresh token.
    pub fn rotating(rotated_refresh_token: &str) -> Self {
        Self {
            rotated_refresh_token: Some(rotated_refresh_token.to_owned()),
            ..Self::new()
        }
    }
}

impl OAuthProvider for FakeOAuthProvider {
    fn construct_authorize_url(
        &self,
        state: &str,
        login: UpstreamLogin<'_>,
    ) -> anyhow::Result<String> {
        let page = match login {
            UpstreamLogin::Google => "authorize",
            UpstreamLogin::LoginPage => "login",
            UpstreamLogin::Sso { .. } => "sso",
        };
        Ok(format!("https://upstream.example/{page}?state={state}"))
    }

    fn exchange_authorization_code<'a>(&'a self, _code: &'a str) -> UpstreamTokensFuture<'a> {
        Box::pin(async move {
            if let Some(failure) = &self.code_exchange_failure {
                return Err(failure());
            }
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
            if let Some(failure) = &self.refresh_failure {
                return Err(failure());
            }
            if self
                .revoked_refresh_tokens
                .lock()
                .expect("revoked refresh tokens lock")
                .contains(refresh_token.as_str())
            {
                return Err(UpstreamGrantError::InvalidGrant {
                    detail: "invalid_grant (refresh_token_not_found)".to_owned(),
                });
            }
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

    fn revoke_refresh_token<'a>(
        &'a self,
        refresh_token: &'a RefreshToken,
    ) -> UpstreamRevocationFuture<'a> {
        Box::pin(async move {
            self.revoked_refresh_tokens
                .lock()
                .expect("revoked refresh tokens lock")
                .insert(refresh_token.as_str().to_owned());
            Ok(())
        })
    }
}

/// Email provider that sends codes to one address and accepts one code,
/// standing in for the authentication service.
#[derive(Default)]
pub struct FakeEmailCodes {
    requested: Mutex<Vec<String>>,
}

impl FakeEmailCodes {
    /// The addresses a code was requested for.
    pub fn requested(&self) -> Vec<String> {
        self.requested.lock().expect("requested lock").clone()
    }
}

impl EmailCodeProvider for FakeEmailCodes {
    fn request_code<'a>(&'a self, email: &'a str) -> EmailCodeRequestFuture<'a> {
        Box::pin(async move {
            self.requested
                .lock()
                .expect("requested lock")
                .push(email.to_owned());
            match email {
                EMAIL_ADDRESS => Ok(EmailCodeRequest::Sent),
                SSO_EMAIL_ADDRESS => Ok(EmailCodeRequest::SsoRequired {
                    idp_id: "idp-1".to_owned(),
                }),
                _ => Err(EmailCodeError::NotAllowed),
            }
        })
    }

    fn redeem_code<'a>(&'a self, _email: &'a str, code: &'a str) -> EmailCodeTokensFuture<'a> {
        Box::pin(async move {
            if code != EMAIL_CODE {
                return Err(EmailCodeError::InvalidCode);
            }
            Ok(UpstreamTokens {
                access_token: AccessToken::from(UPSTREAM_ACCESS_TOKEN),
                refresh_token: RefreshToken::from(UPSTREAM_REFRESH_TOKEN),
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
    /// The upstream provider the service was built with.
    pub provider: Arc<FakeOAuthProvider>,
    /// The email code provider the service was built with.
    pub email_codes: Arc<FakeEmailCodes>,
    /// The secret cookie of the browser the tests drive flows from.
    pub browser: BrowserBinding,
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
        let provider = Arc::new(provider);
        let email_codes = Arc::new(FakeEmailCodes::default());
        let service = McpAuthProxyServiceImpl::new(McpAuthProxyServiceDeps {
            public_url: "https://mcp.macro.com".to_owned(),
            redirect_uri_policy: RedirectUriPolicy::new(["claude.ai", "chatgpt.com"]),
            inflight_auth: Arc::clone(&inflight),
            client_registrations: Arc::clone(&registry) as Arc<dyn ClientRegistrationStore>,
            refresh_token_bindings: Arc::clone(&registry) as Arc<dyn RefreshTokenBindingStore>,
            oauth_provider: Arc::clone(&provider) as Arc<dyn OAuthProvider>,
            email_codes: Arc::clone(&email_codes) as Arc<dyn EmailCodeProvider>,
            resources: McpResources::new(HARNESS_RESOURCE.to_owned(), CHATGPT_RESOURCE.to_owned()),
            macro_api_tokens: Arc::new(FakeMacroApiTokens),
        });

        Self {
            service,
            inflight,
            registry,
            provider,
            email_codes,
            browser: BrowserBinding::generate(),
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
            sign_in: None,
            delivery: None,
            scope: None,
            resource: None,
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
            .start_authorization(
                self.authorize_request(client_id, redirect_uri, &code_challenge_for(code_verifier)),
                self.browser.clone(),
                UserConsent::NotAsked,
            )
            .await
            .expect("authorize should succeed");

        let session_id = self.inflight.only_pending_session_id();
        let delivery = self
            .service
            .complete_callback(
                CallbackRequest {
                    code: Some("upstream-code".to_owned()),
                    state: Some(session_id),
                    error: None,
                    error_description: None,
                },
                Some(self.browser.clone()),
            )
            .await
            .expect("callback should succeed");

        query_param(&delivery.url, "code").expect("redirect carries a code")
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

#[cfg(feature = "outbound")]
pub use fake_kms::FakeKms;

#[cfg(feature = "outbound")]
mod fake_kms {
    use std::{collections::HashMap, sync::Mutex};

    use cursor_api_key::cipher::{KmsCiphertexts, KmsCiphertextsError};
    use zeroize::Zeroizing;

    /// A ciphertext, the context it was encrypted under, and its plaintext.
    type Encryption = (Vec<u8>, HashMap<String, String>, Vec<u8>);

    /// A KMS that, like the real one, refuses a decrypt whose context differs
    /// from the one the ciphertext was encrypted under.
    #[derive(Default)]
    pub struct FakeKms {
        stored: Mutex<Vec<Encryption>>,
    }

    #[async_trait::async_trait]
    impl KmsCiphertexts for FakeKms {
        async fn encrypt(
            &self,
            encryption_context: HashMap<String, String>,
            plaintext: &[u8],
        ) -> Result<(Vec<u8>, String), KmsCiphertextsError> {
            let mut stored = self.stored.lock().expect("lock");
            let ciphertext = format!("ciphertext-{}", stored.len()).into_bytes();
            stored.push((ciphertext.clone(), encryption_context, plaintext.to_vec()));
            Ok((ciphertext, "fake-kms-key".to_owned()))
        }

        async fn decrypt(
            &self,
            _kms_key_id: &str,
            ciphertext: &[u8],
            encryption_context: HashMap<String, String>,
        ) -> Result<Zeroizing<Vec<u8>>, KmsCiphertextsError> {
            self.stored
                .lock()
                .expect("lock")
                .iter()
                .find(|(stored, context, _)| stored == ciphertext && *context == encryption_context)
                .map(|(_, _, plaintext)| Zeroizing::new(plaintext.clone()))
                .ok_or(KmsCiphertextsError)
        }
    }
}
