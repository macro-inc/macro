#![deny(missing_docs)]
//! FusionAuth API client library.

/// Apple identity provider login.
pub mod apple;
/// FusionAuth error types.
pub mod error;
/// Google identity provider and OAuth.
pub mod google;
/// Identity provider management (links, login, lookup, search, unlink).
pub mod identity_provider;
/// JWT refresh operations.
pub mod jwt;
/// Logout operations.
pub mod logout;
/// OAuth authorization code grant.
pub mod oauth;
/// Password-based login.
pub mod password;
/// Passwordless login flow.
pub mod passwordless;
/// User management (create, delete, get, register, verify).
pub mod user;

/// Result type alias using [`error::FusionAuthClientError`] as the default error.
pub type Result<T, E = error::FusionAuthClientError> = std::result::Result<T, E>;

use anyhow::Context;

use reqwest::Url;

/// An HTTP client with default Authorization and optional tenant headers.
#[derive(Clone, Debug)]
pub struct AuthedClient {
    inner: reqwest::Client,
}

/// Used to specify what tenant id we want to use
const FUSIONAUTH_TENANT_ID_HEADER: &str = "X-FusionAuth-TenantId";

impl AuthedClient {
    /// Creates a new authenticated client with the given API key and tenant ID.
    pub fn new(url: &str, api_key: String, tenant_id: String) -> Self {
        Self::with_tenant_header(api_key, tenant_id, should_infer_local_tenant_header(url))
    }

    fn with_tenant_header(api_key: String, tenant_id: String, include_tenant: bool) -> Self {
        let auth_headers = auth_headers(api_key, tenant_id, include_tenant);
        let client = reqwest::Client::builder()
            .default_headers(auth_headers)
            .build()
            .unwrap();

        Self { inner: client }
    }

    /// Returns a reference to the inner reqwest client.
    pub fn client(&self) -> &reqwest::Client {
        &self.inner
    }
}

fn auth_headers(
    api_key: String,
    tenant_id: String,
    include_tenant: bool,
) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(reqwest::header::AUTHORIZATION, api_key.parse().unwrap());

    if include_tenant {
        tracing::trace!(
            "inserting {} header into fusionauth authed client",
            FUSIONAUTH_TENANT_ID_HEADER
        );
        headers.insert(FUSIONAUTH_TENANT_ID_HEADER, tenant_id.parse().unwrap());
    }

    headers
}

/// An HTTP client without authentication headers.
#[derive(Clone, Debug, Default)]
pub struct UnauthedClient {
    inner: reqwest::Client,
}

impl UnauthedClient {
    /// Creates a new unauthenticated client.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns a reference to the inner reqwest client.
    pub fn client(&self) -> &reqwest::Client {
        &self.inner
    }
}

/// The main FusionAuth API client.
#[derive(Clone, Debug)]
pub struct FusionAuthClient {
    /// The fusionauth client id
    client_id: String,
    /// The fusionauth client secret
    client_secret: String,
    /// The base url for the fusion auth api
    fusion_auth_base_url: String,
    /// The browser-reachable base URL used for OAuth authorization redirects.
    fusion_auth_public_url: String,
    /// The oauth redirect uri
    oauth_redirect_uri: String,
    /// The authenticated client with default Authorization header
    auth_client: AuthedClient,
    /// The unauthenticated client for requests that don't need authorization
    unauth_client: UnauthedClient,
    /// The client ID for Google identity provider
    google_client_id: String,
    /// The client secret for Google identity provider
    google_client_secret: String,
}

impl FusionAuthClient {
    /// Creates a new FusionAuth client with the given configuration.
    #[expect(clippy::too_many_arguments, reason = "too annoying to fix")]
    pub fn new(
        tenant_id: String,
        api_key: String,
        client_id: String,
        client_secret: String,
        fusion_auth_base_url: String,
        oauth_redirect_uri: String,
        google_client_id: String,
        google_client_secret: String,
    ) -> Self {
        Self::new_inner(
            tenant_id,
            api_key,
            client_id,
            client_secret,
            fusion_auth_base_url,
            oauth_redirect_uri,
            google_client_id,
            google_client_secret,
            false,
        )
    }

    /// Creates a client for a local FusionAuth instance.
    ///
    /// Local FusionAuth contains multiple tenants, so this always sends the
    /// tenant header instead of inferring locality from the host port.
    #[expect(
        clippy::too_many_arguments,
        reason = "matches the existing constructor"
    )]
    pub fn new_for_local_instance(
        tenant_id: String,
        api_key: String,
        client_id: String,
        client_secret: String,
        fusion_auth_base_url: String,
        oauth_redirect_uri: String,
        google_client_id: String,
        google_client_secret: String,
    ) -> Self {
        Self::new_inner(
            tenant_id,
            api_key,
            client_id,
            client_secret,
            fusion_auth_base_url,
            oauth_redirect_uri,
            google_client_id,
            google_client_secret,
            true,
        )
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "shared constructor implementation"
    )]
    fn new_inner(
        tenant_id: String,
        api_key: String,
        client_id: String,
        client_secret: String,
        fusion_auth_base_url: String,
        oauth_redirect_uri: String,
        google_client_id: String,
        google_client_secret: String,
        force_tenant_header: bool,
    ) -> Self {
        let auth_client = if force_tenant_header {
            AuthedClient::with_tenant_header(api_key, tenant_id, true)
        } else {
            AuthedClient::new(&fusion_auth_base_url, api_key, tenant_id)
        };
        let unauth_client = UnauthedClient::new();
        let fusion_auth_public_url = fusion_auth_base_url.clone();

        Self {
            client_id,
            client_secret,
            fusion_auth_base_url,
            fusion_auth_public_url,
            oauth_redirect_uri,
            auth_client,
            unauth_client,
            google_client_id,
            google_client_secret,
        }
    }

    /// Sets the browser-reachable FusionAuth base URL used to construct OAuth
    /// authorization redirects. API calls continue using the internal base URL.
    pub fn with_public_url(mut self, fusion_auth_public_url: String) -> Self {
        self.fusion_auth_public_url = fusion_auth_public_url;
        self
    }

    /// Returns the Google OAuth client ID.
    pub fn google_client_id(&self) -> &str {
        &self.google_client_id
    }

    /// Constructs the oauth2 authorize url for the given idp
    /// If login_hint is provided, it will be used as the login_hint parameter. This is used to
    /// ensure users are correctly redirected for domain specific SSO
    #[tracing::instrument(skip(self, state), level = tracing::Level::TRACE)]
    pub fn construct_oauth2_authorize_url<T>(
        &self,
        idp_id: &str,
        login_hint: Option<&str>,
        state: Option<T>,
    ) -> anyhow::Result<String>
    where
        T: serde::Serialize + std::fmt::Debug + 'static,
    {
        let mut url = Url::parse(&format!("{}/oauth2/authorize", self.fusion_auth_public_url))
            .expect("Invalid base URL");

        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", &self.oauth_redirect_uri)
            .append_pair("idp_hint", idp_id)
            .append_pair("response_type", "code")
            .append_pair("scope", "openid profile email offline_access")
            .append_pair("access_type", "offline"); // Explicitly request offline access

        if let Some(state) = state {
            tracing::trace!(state=?state, "state provided");
            let state_str = serde_json::to_string(&state)
                .context("should be able to deserialize state into string")?;
            url.query_pairs_mut().append_pair("state", &state_str);
        }

        if let Some(login_hint) = login_hint {
            url.query_pairs_mut().append_pair("login_hint", login_hint);
        }

        Ok(url.to_string())
    }
}

/// Preserves automatic tenant-header behavior for the default local endpoints.
/// Named-instance clients opt into local tenant behavior explicitly instead of
/// inferring service identity from a host port.
#[tracing::instrument(level = tracing::Level::TRACE)]
fn should_infer_local_tenant_header(url: &str) -> bool {
    url.starts_with("http://fusionauth:9011") || url.starts_with("http://localhost:9011")
}

#[cfg(test)]
mod test;
