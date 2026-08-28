use crate::domain::models::{
    CatalogEntry, CatalogPage, ConnectToken, McpServer, PipedreamAccount, PipedreamConnection,
    client_info,
};
use crate::domain::ports::{ConnectorDirectory, McpConnection, PipedreamConnect};
use anyhow::Context;
use reqwest::header::{HeaderMap, HeaderValue};
use rmcp::service::ServiceExt;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use url::Url;

/// Default base URL of the Pipedream REST API.
pub const DEFAULT_API_URL: &str = "https://api.pipedream.com";

/// Default URL of Pipedream's hosted remote MCP server.
pub const DEFAULT_MCP_URL: &str = "https://remote.mcp.pipedream.net";

/// Safety margin subtracted from an access token's lifetime, so we never
/// present a token about to expire mid-request.
const TOKEN_EXPIRY_MARGIN: Duration = Duration::from_secs(60);

/// Configuration for [`PipedreamClient`].
#[derive(Clone, Debug)]
pub struct PipedreamConfig {
    /// OAuth client ID for the Pipedream API (project settings → API keys).
    pub client_id: String,
    /// OAuth client secret for the Pipedream API.
    pub client_secret: String,
    /// The Pipedream Connect project ID (`proj_...`).
    pub project_id: String,
    /// The Pipedream project environment: `development` or `production`.
    pub environment: String,
    /// Origins allowed to use Connect tokens from the browser (the app
    /// origins that embed the hosted Connect UI). Pipedream refuses to be
    /// framed by origins outside this list; localhost is only tolerated by
    /// default in the `development` project environment.
    pub allowed_origins: Vec<String>,
    /// Base URL of the Pipedream API. [`DEFAULT_API_URL`] unless overridden.
    pub api_url: String,
    /// URL of Pipedream's remote MCP server. [`DEFAULT_MCP_URL`] unless
    /// overridden.
    pub mcp_url: String,
}

/// HTTP adapter for Pipedream Connect and Pipedream's remote MCP server.
///
/// Implements [`PipedreamConnect`] (Connect tokens + account lifecycle),
/// [`ConnectorDirectory`] (the app directory backing the catalog), and
/// [`McpConnection`] (per-user, per-app MCP sessions). API access tokens are
/// obtained via the OAuth client-credentials grant and cached until shortly
/// before expiry.
pub struct PipedreamClient {
    http: reqwest::Client,
    config: PipedreamConfig,
    access_token: Mutex<Option<CachedToken>>,
}

#[derive(Clone)]
struct CachedToken {
    token: String,
    valid_until: Instant,
}

impl PipedreamClient {
    /// Build a client from config. Fails only if the underlying HTTP client
    /// can't be constructed.
    pub fn new(config: PipedreamConfig) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .context("building Pipedream HTTP client")?;
        Ok(Self {
            http,
            config,
            access_token: Mutex::new(None),
        })
    }

    fn api(&self, path: &str) -> String {
        format!("{}/v1{path}", self.config.api_url.trim_end_matches('/'))
    }

    fn connect_api(&self, path: &str) -> String {
        self.api(&format!("/connect/{}{path}", self.config.project_id))
    }

    /// A valid API access token, fetched via the client-credentials grant
    /// and cached until shortly before expiry.
    async fn access_token(&self) -> anyhow::Result<String> {
        if let Some(cached) = self.access_token.lock().unwrap().as_ref()
            && cached.valid_until > Instant::now()
        {
            return Ok(cached.token.clone());
        }
        tracing::debug!("pipedream api token absent or near expiry; requesting a fresh one");

        let response = self
            .http
            .post(self.api("/oauth/token"))
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
            ])
            .send()
            .await
            .context("requesting Pipedream access token")?;
        let response = error_for_status(response).await?;

        let token: TokenResponse = response
            .json()
            .await
            .context("decoding Pipedream token response")?;

        let ttl = Duration::from_secs(token.expires_in.unwrap_or(3600))
            .saturating_sub(TOKEN_EXPIRY_MARGIN);
        *self.access_token.lock().unwrap() = Some(CachedToken {
            token: token.access_token.clone(),
            valid_until: Instant::now() + ttl,
        });

        Ok(token.access_token)
    }

    async fn authed(
        &self,
        req: reqwest::RequestBuilder,
    ) -> anyhow::Result<reqwest::RequestBuilder> {
        Ok(req
            .bearer_auth(self.access_token().await?)
            .header("X-PD-Environment", &self.config.environment))
    }
}

impl PipedreamConnect for PipedreamClient {
    #[tracing::instrument(skip(self), err)]
    async fn create_connect_token(&self, external_user_id: &str) -> anyhow::Result<ConnectToken> {
        let mut body = serde_json::json!({
            "external_user_id": external_user_id,
            "external_id": external_user_id,
        });
        if !self.config.allowed_origins.is_empty() {
            body["allowed_origins"] = serde_json::json!(self.config.allowed_origins);
        }

        let response = self
            .authed(self.http.post(self.connect_api("/tokens")))
            .await?
            .json(&body)
            .send()
            .await
            .context("creating Pipedream connect token")?;
        let response = error_for_status(response).await?;

        let token: ConnectTokenResponse = response
            .json()
            .await
            .context("decoding Pipedream connect token response")?;

        Ok(ConnectToken {
            token: token.token,
            expires_at: token.expires_at,
            connect_link_url: token.connect_link_url,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_account(&self, account_id: &str) -> anyhow::Result<Option<PipedreamAccount>> {
        let response = self
            .authed(
                self.http
                    .get(self.connect_api(&format!("/accounts/{account_id}"))),
            )
            .await?
            .send()
            .await
            .context("fetching Pipedream account")?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let response = error_for_status(response).await?;

        // Tolerate both a bare account object and a `{"data": ...}` envelope.
        let body: serde_json::Value = response
            .json()
            .await
            .context("decoding Pipedream account response")?;
        let account = body.get("data").unwrap_or(&body).clone();
        let account: AccountResponse =
            serde_json::from_value(account).context("parsing Pipedream account")?;

        Ok(Some(PipedreamAccount {
            id: account.id,
            external_user_id: account.external_id,
            app_slug: account.app.name_slug,
            app_name: account.app.name,
            healthy: account.healthy.unwrap_or(true),
        }))
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_account(&self, account_id: &str) -> anyhow::Result<()> {
        let response = self
            .authed(
                self.http
                    .delete(self.connect_api(&format!("/accounts/{account_id}"))),
            )
            .await?
            .send()
            .await
            .context("deleting Pipedream account")?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            // Already gone remotely — nothing left to revoke.
            return Ok(());
        }
        error_for_status(response).await?;
        Ok(())
    }
}

impl ConnectorDirectory for PipedreamClient {
    #[tracing::instrument(skip(self), err)]
    async fn search(
        &self,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> anyhow::Result<CatalogPage> {
        let mut query: Vec<(&str, String)> = vec![
            ("limit", limit.to_string()),
            // `featured_weight` is Pipedream's popularity ordering (the sort
            // behind pipedream.com/apps); without it the directory comes back
            // in an order nobody would browse.
            ("sort_key", "featured_weight".to_owned()),
            ("sort_direction", "desc".to_owned()),
            // Apps without actions expose no MCP tools, so there is nothing
            // to connect them for.
            ("has_actions", "true".to_owned()),
        ];
        if let Some(search) = search {
            query.push(("q", search.to_owned()));
        }
        if let Some(cursor) = cursor {
            query.push(("after", cursor.to_owned()));
        }

        let response = self
            .authed(self.http.get(self.api("/connect/apps")))
            .await?
            .query(&query)
            .send()
            .await
            .context("querying Pipedream app directory")?;
        let response = error_for_status(response).await?;

        let body: AppsResponse = response
            .json()
            .await
            .context("decoding Pipedream apps response")?;

        // The page is exhausted when it comes back short; `end_cursor` alone
        // can't tell us, since it's present on the last page too.
        let next_cursor = if body.data.len() < limit as usize {
            None
        } else {
            body.page_info.and_then(|p| p.end_cursor)
        };

        let entries = body
            .data
            .into_iter()
            // Apps without an auth flow have nothing to connect.
            .filter(|app| app.auth_type.as_deref() != Some("none"))
            .map(|app| CatalogEntry {
                app_slug: app.name_slug,
                display_name: app.name,
                description: app.description.filter(|d| !d.is_empty()),
                icon_url: Some(app.img_src).filter(|u| u.starts_with("https://")),
            })
            .collect();

        Ok(CatalogPage {
            entries,
            next_cursor,
        })
    }
}

/// How to address Pipedream's remote MCP server on behalf of one user's
/// connected app.
///
/// The bearer is our project-level API token and the headers are what scope a
/// request to the user and app - Pipedream injects the account's own
/// credentials server-side from nothing but these. That is why this exists as
/// a value handed to a proxy rather than only inside a client: whoever holds
/// the bearer can claim to be any user, so the caller is expected to keep it
/// away from anything user-controlled.
///
/// An outbound vocabulary, not a domain one, typed accordingly: headers are a
/// validated `HeaderMap` and the destination a parsed `Url`, so an injectable
/// value fails here, where it originates, and consumers have nothing left to
/// re-validate.
#[derive(Clone, Debug)]
pub struct McpUpstreamCall {
    /// URL of Pipedream's remote MCP server.
    pub url: Url,
    /// Our project API token, for `Authorization: Bearer`.
    pub bearer_token: String,
    /// The `x-pd-*` headers scoping the call to the record's user and app.
    pub headers: HeaderMap,
}

/// Port for addressing Pipedream's remote MCP server without opening a
/// session on it.
///
/// What [`McpConnection`] uses under the hood, exposed for callers that
/// proxy raw MCP-over-HTTP traffic instead of speaking MCP themselves: they
/// need the URL, bearer, and scoping headers to stamp onto a request that
/// already exists. The returned call carries our project-level bearer, so it
/// must never travel anywhere user-controlled.
pub trait McpUpstream: Send + Sync + 'static {
    /// The upstream call scoped to `record`'s app for `record.user_id`.
    fn upstream(
        &self,
        record: &PipedreamConnection,
    ) -> impl Future<Output = anyhow::Result<McpUpstreamCall>> + Send;
}

impl McpUpstream for PipedreamClient {
    #[tracing::instrument(skip_all, err, fields(app = %record.app_slug, user_id = %record.user_id))]
    async fn upstream(&self, record: &PipedreamConnection) -> anyhow::Result<McpUpstreamCall> {
        let mut headers = HeaderMap::new();
        let header = |value: &str| {
            HeaderValue::from_str(value).with_context(|| format!("{value:?} is not a header value"))
        };
        headers.insert("x-pd-project-id", header(&self.config.project_id)?);
        headers.insert("x-pd-environment", header(&self.config.environment)?);
        headers.insert("x-pd-external-user-id", header(record.user_id.as_ref())?);
        headers.insert("x-pd-app-slug", header(&record.app_slug)?);
        // Flat per-app tools; no configuration meta-tools.
        headers.insert("x-pd-tool-mode", HeaderValue::from_static("tools-only"));

        Ok(McpUpstreamCall {
            url: Url::parse(&self.config.mcp_url).context("PIPEDREAM_MCP_URL is not a url")?,
            bearer_token: self.access_token().await?,
            headers,
        })
    }
}

impl McpConnection for PipedreamClient {
    #[tracing::instrument(skip_all, err, fields(app = %record.app_slug, user_id = %record.user_id))]
    async fn connect(&self, record: &PipedreamConnection) -> anyhow::Result<McpServer> {
        let upstream = self.upstream(record).await?;

        let mut headers = upstream.headers;
        let mut auth = HeaderValue::from_str(&format!("Bearer {}", upstream.bearer_token))
            .map_err(|e| anyhow::anyhow!("invalid bearer token: {e}"))?;
        auth.set_sensitive(true);
        headers.insert(reqwest::header::AUTHORIZATION, auth);

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .context("building Pipedream MCP HTTP client")?;

        let config = StreamableHttpClientTransportConfig::with_uri(upstream.url.as_str());
        let transport = StreamableHttpClientTransport::with_client(client, config);
        Ok(client_info().serve(transport).await?)
    }
}

async fn error_for_status(response: reqwest::Response) -> anyhow::Result<reqwest::Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    anyhow::bail!("Pipedream API returned {status}: {body}");
}

// -- wire types ---------------------------------------------------------------

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct ConnectTokenResponse {
    token: String,
    expires_at: String,
    connect_link_url: String,
}

#[derive(Deserialize)]
struct AccountResponse {
    id: String,
    external_id: Option<String>,
    healthy: Option<bool>,
    app: AccountApp,
}

#[derive(Deserialize)]
struct AccountApp {
    name_slug: String,
    name: String,
}

#[derive(Deserialize)]
struct AppsResponse {
    data: Vec<AppResponse>,
    page_info: Option<PageInfo>,
}

#[derive(Deserialize)]
struct PageInfo {
    end_cursor: Option<String>,
}

#[derive(Deserialize)]
struct AppResponse {
    name_slug: String,
    name: String,
    // Nullable in the API, not just omissible.
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    auth_type: Option<String>,
    #[serde(default)]
    img_src: String,
}
