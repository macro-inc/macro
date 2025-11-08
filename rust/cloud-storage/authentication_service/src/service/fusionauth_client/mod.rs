pub(crate) mod apple;
pub(crate) mod error;
pub(crate) mod google;
pub(crate) mod identity_provider;
pub(crate) mod jwt;
pub(crate) mod logout;
pub(crate) mod oauth;
pub(crate) mod password;
pub(crate) mod passwordless;
pub mod user;

pub type Result<T, E = error::FusionAuthClientError> = std::result::Result<T, E>;

use anyhow::Context;

use reqwest::Url;

#[derive(Clone, Debug)]
pub struct AuthedClient {
    inner: reqwest::Client,
}

impl AuthedClient {
    pub fn new(api_key: String) -> Self {
        // Create authenticated client with default Authorization header
        let mut auth_headers = reqwest::header::HeaderMap::new();
        auth_headers.insert(reqwest::header::AUTHORIZATION, api_key.parse().unwrap());

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

#[derive(Clone, Debug)]
pub struct UnauthedClient {
    inner: reqwest::Client,
}

impl UnauthedClient {
    pub fn new() -> Self {
        let client = reqwest::Client::new();

        Self { inner: client }
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
        api_key: String,
        client_id: String,
        client_secret: String,
        application_id: String,
        fusion_auth_base_url: String,
        oauth_redirect_uri: String,
        google_client_id: String,
        google_client_secret: String,
    ) -> Self {
        let auth_client = AuthedClient::new(api_key);
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
    #[tracing::instrument(skip(self, state), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub fn construct_oauth2_authorize_url<'a, T>(
        &self,
        idp_id: &str,
        login_hint: Option<&'a str>,
        state: Option<T>,
    ) -> anyhow::Result<String>
    where
        T: serde::Serialize + std::fmt::Debug + 'static,
    {
        let mut url = Url::parse(&format!("{}/oauth2/authorize", self.fusion_auth_base_url))
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
