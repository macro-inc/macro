pub mod apple;
pub mod error;
pub mod google;
pub mod identity_provider;
pub mod jwt;
pub mod logout;
pub mod oauth;
pub mod password;
pub mod passwordless;
pub mod user;

pub type Result<T, E = error::FusionAuthClientError> = std::result::Result<T, E>;

use anyhow::Context;

use reqwest::Url;

#[derive(Clone, Debug)]
pub struct AuthedClient {
    inner: reqwest::Client,
}

/// Used to specify what tenant id we want to use
const FUSIONAUTH_TENANT_ID_HEADER: &str = "X-FusionAuth-TenantId";

impl AuthedClient {
    pub fn new(url: &str, api_key: String, tenant_id: String) -> Self {
        // Create authenticated client with default Authorization header
        let mut auth_headers = reqwest::header::HeaderMap::new();
        auth_headers.insert(reqwest::header::AUTHORIZATION, api_key.parse().unwrap());

        // NOTE: we only want to insert this header automatically if we are
        // using a local fusionauth instance
        // This is due to the local fusionauth instance containing 2 tenants
        if is_local_fusionauth(url) {
            // We need to insert the
            tracing::trace!(
                "inserting {} header into fusionauth authed client",
                FUSIONAUTH_TENANT_ID_HEADER
            );
            auth_headers.insert(FUSIONAUTH_TENANT_ID_HEADER, tenant_id.parse().unwrap());
        }

        let client = reqwest::Client::builder()
            .default_headers(auth_headers)
            .build()
            .unwrap();

        Self { inner: client }
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.inner
    }
}

#[derive(Clone, Debug, Default)]
pub struct UnauthedClient {
    inner: reqwest::Client,
}

impl UnauthedClient {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.inner
    }
}

#[derive(Clone, Debug)]
pub struct FusionAuthClient {
    /// The fusionauth client id
    client_id: String,
    /// The fusionauth client secret
    client_secret: String,
    /// The fusionauth application id
    application_id: String,
    /// The base url for the fusion auth api
    fusion_auth_base_url: String,
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
    #[expect(clippy::too_many_arguments, reason = "too annoying to fix")]
    pub fn new(
        tenant_id: String,
        api_key: String,
        client_id: String,
        client_secret: String,
        application_id: String,
        fusion_auth_base_url: String,
        oauth_redirect_uri: String,
        google_client_id: String,
        google_client_secret: String,
    ) -> Self {
        let auth_client = AuthedClient::new(&fusion_auth_base_url, api_key, tenant_id);
        let unauth_client = UnauthedClient::new();

        Self {
            client_id,
            client_secret,
            application_id,
            fusion_auth_base_url,
            oauth_redirect_uri,
            auth_client,
            unauth_client,
            google_client_id,
            google_client_secret,
        }
    }

    /// Constructs the oauth2 authorize url for the given idp
    /// If login_hint is provided, it will be used as the login_hint parameter. This is used to
    /// ensure users are correctly redirected for domain specific SSO
    #[tracing::instrument(skip(self, state), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url), level = tracing::Level::TRACE)]
    pub fn construct_oauth2_authorize_url<T>(
        &self,
        idp_id: &str,
        login_hint: Option<&str>,
        state: Option<T>,
    ) -> anyhow::Result<String>
    where
        T: serde::Serialize + std::fmt::Debug + 'static,
    {
        let mut url = Url::parse(&format!(
            "{}/oauth2/authorize",
            transform_fusionauth_url(&self.fusion_auth_base_url)
        ))
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

/// Determines if fusionauth is local based on the url
#[tracing::instrument(level = tracing::Level::TRACE)]
fn is_local_fusionauth(url: &str) -> bool {
    url.starts_with("http://fusionauth:9011") || url.starts_with("http://localhost:9011")
}

/// Transforms the url replacing the domain with localhost
#[tracing::instrument(level = tracing::Level::TRACE)]
fn transform_local_fusionauth_url(url: &str) -> String {
    if is_local_fusionauth(url) {
        url.replace("fusionauth", "localhost")
    } else {
        url.to_string()
    }
}

/// Transforms the fusionauth url from the docker-network version into the
/// local version that will work in the browser.
#[tracing::instrument(level = tracing::Level::TRACE)]
fn transform_fusionauth_url(url: &str) -> String {
    // TODO: may want to make this something we initialize once
    match macro_env::Environment::new_or_prod() {
        macro_env::Environment::Local => transform_local_fusionauth_url(url),
        _ => url.to_string(),
    }
}

#[cfg(test)]
mod test;
