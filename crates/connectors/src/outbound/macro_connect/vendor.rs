//! Macro Connect over `connect_client`: the catalog, the connect session,
//! the user's connections, the MCP gateway and exported access tokens.

use crate::domain::models::{ApiRequest, ApiResponse, Upstream};
use crate::outbound::hosted_connections::RevokeGrant;
use connect_client::{ConnectClient, wire};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_toolset::{McpServer, client_info};
use reqwest::header::{HeaderMap, HeaderValue};
use rmcp::service::ServiceExt;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rootcause::Report;
use std::sync::Arc;
use std::time::{Duration, Instant};
use url::Url;

/// How long a fetched Connect catalog is reused. The catalog changes only
/// when Connect deploys, and every resolution of a user on Connect reads it.
const CATALOG_TTL: Duration = Duration::from_secs(5 * 60);

/// How long one call to a connected app's API may take.
const API_TIMEOUT: Duration = Duration::from_secs(30);

/// Configuration for Macro Connect.
#[derive(Clone)]
pub struct ConnectConfig {
    /// Connect API base URL, e.g. `https://connect-dev.macro.com`.
    pub api_url: String,
    /// Macro's customer key for the Connect API.
    pub customer_key: String,
    /// Where Connect sends the browser after consent.
    pub callback_url: Url,
}

impl std::fmt::Debug for ConnectConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConnectConfig")
            .field("api_url", &self.api_url)
            .field("customer_key", &"[REDACTED]")
            .field("callback_url", &self.callback_url)
            .finish()
    }
}

/// What the Connect source needs from Macro Connect.
///
/// `#[async_trait]` because the source and every connection it hands out
/// share one `Arc<dyn ConnectVendor>`.
#[async_trait::async_trait]
pub(crate) trait ConnectVendor: RevokeGrant {
    /// Connect's catalog, cached.
    async fn catalog(&self) -> Result<Arc<Vec<wire::CatalogEntry>>, Report>;

    /// Start a browser connect session for the user to `app_id`; Macro asks
    /// for it as `app_slug`. Returns the page to open.
    async fn connect_url(
        &self,
        user: &MacroUserIdStr<'static>,
        app_id: &str,
        app_slug: &str,
    ) -> Result<Url, Report>;

    /// Every connection Connect holds for the user, with its status.
    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<wire::Connection>, Report>;

    /// Open an MCP session on Connect's gateway for the user's `app_id`.
    async fn dial(&self, user: &MacroUserIdStr<'static>, app_id: &str)
    -> Result<McpServer, Report>;

    /// The gateway address and customer credential for the user's `app_id`.
    fn upstream(&self, user: &MacroUserIdStr<'static>, app_id: &str) -> Upstream;

    /// Call `app_id`'s own API with the user's exported access token. A
    /// failed export carries its [`connect_client::Error`] as the report's
    /// context.
    async fn call(
        &self,
        user: &MacroUserIdStr<'static>,
        app_id: &str,
        request: ApiRequest,
    ) -> Result<ApiResponse, Report>;
}

/// [`ConnectVendor`] over Connect's HTTP API.
pub(crate) struct ConnectVendorClient {
    client: ConnectClient,
    api_url: Url,
    callback_url: Url,
    http: reqwest::Client,
    catalog: tokio::sync::Mutex<Option<(Instant, Arc<Vec<wire::CatalogEntry>>)>>,
}

impl ConnectVendorClient {
    /// A client for `config`. Fails when the base URL is not an HTTP URL.
    pub(crate) fn new(config: ConnectConfig) -> Result<Self, Report> {
        let api_url = Url::parse(&config.api_url).map_err(Report::new)?;
        let client =
            ConnectClient::new(&config.api_url, config.customer_key).map_err(Report::new)?;
        let http = reqwest::Client::builder()
            .timeout(API_TIMEOUT)
            .build()
            .map_err(Report::new)?;

        Ok(Self {
            client,
            api_url,
            callback_url: config.callback_url,
            http,
            catalog: tokio::sync::Mutex::new(None),
        })
    }

    /// The Connect origin; catalog icon paths are relative to it.
    pub(crate) fn api_url(&self) -> &Url {
        &self.api_url
    }
}

#[async_trait::async_trait]
impl RevokeGrant for ConnectVendorClient {
    #[tracing::instrument(skip(self, user), err)]
    async fn revoke(&self, user: &MacroUserIdStr<'static>, account_id: &str) -> Result<(), Report> {
        match self
            .client
            .delete_connection(user.as_ref(), account_id)
            .await
        {
            Ok(_) | Err(connect_client::Error::NotConnected) => Ok(()),
            Err(error) => Err(Report::new(error).into_dynamic()),
        }
    }
}

#[async_trait::async_trait]
impl ConnectVendor for ConnectVendorClient {
    async fn catalog(&self) -> Result<Arc<Vec<wire::CatalogEntry>>, Report> {
        // Held across the fetch so concurrent misses make one request.
        let mut cached = self.catalog.lock().await;
        if let Some((fetched, apps)) = cached.as_ref()
            && fetched.elapsed() < CATALOG_TTL
        {
            return Ok(apps.clone());
        }

        let apps = Arc::new(self.client.catalog().await.map_err(Report::new)?);
        *cached = Some((Instant::now(), apps.clone()));
        Ok(apps)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn connect_url(
        &self,
        user: &MacroUserIdStr<'static>,
        app_id: &str,
        app_slug: &str,
    ) -> Result<Url, Report> {
        // The callback page records nothing; the slug only lets it say
        // which app finished.
        let mut redirect = self.callback_url.clone();
        redirect.query_pairs_mut().append_pair("app_slug", app_slug);

        let session = self
            .client
            .create_connect_session(user.as_ref(), app_id, redirect.as_str())
            .await
            .map_err(Report::new)?;
        Url::parse(&session.connect_url).map_err(|error| Report::new(error).into_dynamic())
    }

    #[tracing::instrument(skip_all, err)]
    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<wire::Connection>, Report> {
        self.client
            .connections(user.as_ref())
            .await
            .map_err(|error| Report::new(error).into_dynamic())
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn dial(
        &self,
        user: &MacroUserIdStr<'static>,
        app_id: &str,
    ) -> Result<McpServer, Report> {
        let upstream = self.client.mcp_upstream(user.as_ref(), app_id);
        let mut auth = HeaderValue::from_str(&format!("Bearer {}", upstream.bearer_token))
            .map_err(Report::new)?;
        auth.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert(reqwest::header::AUTHORIZATION, auth);

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .map_err(Report::new)?;
        let config = StreamableHttpClientTransportConfig::with_uri(upstream.url.as_str());
        let transport = StreamableHttpClientTransport::with_client(client, config);
        client_info()
            .serve(transport)
            .await
            .map_err(|error| Report::new(error).into_dynamic())
    }

    fn upstream(&self, user: &MacroUserIdStr<'static>, app_id: &str) -> Upstream {
        let upstream = self.client.mcp_upstream(user.as_ref(), app_id);
        Upstream::new(
            upstream.url.clone(),
            Some(upstream.bearer_token.clone()),
            HeaderMap::new(),
        )
    }

    #[tracing::instrument(skip(self, user, request), fields(method = %request.method), err)]
    async fn call(
        &self,
        user: &MacroUserIdStr<'static>,
        app_id: &str,
        request: ApiRequest,
    ) -> Result<ApiResponse, Report> {
        let token = self
            .client
            .access_token(user.as_ref(), app_id)
            .await
            .map_err(Report::new)?;

        let mut outgoing = self
            .http
            .request(request.method, &request.url)
            .headers(request.headers)
            .bearer_auth(&token.access_token);
        if let Some(body) = &request.body {
            outgoing = outgoing.json(body);
        }

        let response = outgoing.send().await.map_err(Report::new)?;
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.text().await.map_err(Report::new)?;
        Ok(ApiResponse {
            status,
            headers,
            body,
        })
    }
}
