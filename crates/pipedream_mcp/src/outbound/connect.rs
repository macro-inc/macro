use crate::domain::models::{
    CatalogEntry, CatalogPage, ConnectApp, MacroUserIdStr, McpServer, OrgSetup,
    PipedreamConnection, client_info,
};
use crate::domain::ports::{
    ConnectedAppProxy, ConnectorCapabilities, ConnectorDirectory, MacroConnect, McpConnection,
    ProxyResponse,
};
use crate::domain::service::discovery::ConnectorTool;
use crate::outbound::api::{McpUpstream, McpUpstreamCall};
use anyhow::Context;
use connect_client::{ConnectClient, wire};
use reqwest::header::{HeaderMap, HeaderValue};
use rmcp::service::ServiceExt;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use std::sync::Arc;
use std::time::{Duration, Instant};
use url::Url;

#[cfg(test)]
mod test;

/// How long a fetched Connect catalog is reused. The catalog changes only
/// when Connect deploys, and every connect click and tool listing reads it.
const CATALOG_TTL: Duration = Duration::from_secs(5 * 60);

/// Configuration for [`ConnectAdapter`].
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

/// Macro Connect behind this crate's ports, over `connect_client`.
///
/// Serves records with [`ConnectionProvider::Connect`]: tools through
/// Connect's MCP gateway (Connect attaches the vendor token), app API calls
/// with an exported access token, and the connect flow. Catalog apps are
/// addressed by the Pipedream slugs they replace, or by their Connect id when
/// Pipedream has no such app.
///
/// [`ConnectionProvider::Connect`]: crate::domain::models::ConnectionProvider::Connect
pub struct ConnectAdapter {
    client: ConnectClient,
    api_url: Url,
    callback_url: Url,
    http: reqwest::Client,
    catalog: tokio::sync::Mutex<Option<(Instant, Arc<Vec<wire::CatalogEntry>>)>>,
}

impl ConnectAdapter {
    /// Build an adapter. Fails when the base URL is not an HTTP URL.
    pub fn new(config: ConnectConfig) -> anyhow::Result<Self> {
        let api_url = Url::parse(&config.api_url).context("Connect API URL is not a URL")?;
        let client = ConnectClient::new(&config.api_url, config.customer_key)
            .map_err(|error| anyhow::anyhow!("building Connect client: {error}"))?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .context("building Connect proxy HTTP client")?;
        Ok(Self {
            client,
            api_url,
            callback_url: config.callback_url,
            http,
            catalog: tokio::sync::Mutex::new(None),
        })
    }

    async fn catalog(&self) -> anyhow::Result<Arc<Vec<wire::CatalogEntry>>> {
        let mut cached = self.catalog.lock().await;
        if let Some((fetched, apps)) = cached.as_ref()
            && fetched.elapsed() < CATALOG_TTL
        {
            return Ok(apps.clone());
        }
        let apps = Arc::new(
            self.client
                .catalog()
                .await
                .map_err(|error| anyhow::anyhow!("reading Connect catalog: {error}"))?,
        );
        *cached = Some((Instant::now(), apps.clone()));
        Ok(apps)
    }

    fn upstream_call(&self, record: &PipedreamConnection) -> McpUpstreamCall {
        let upstream = self
            .client
            .mcp_upstream(record.user_id.as_ref(), &record.account_id);
        McpUpstreamCall {
            url: upstream.url.clone(),
            bearer_token: upstream.bearer_token.clone(),
            headers: HeaderMap::new(),
        }
    }
}

/// The slugs Macro addresses a Connect app by: the Pipedream slugs it
/// replaces, or its Connect id when Pipedream has no such app.
fn macro_slugs(app: &wire::CatalogEntry) -> &[String] {
    if app.pipedream_app_slugs.is_empty() {
        std::slice::from_ref(&app.id)
    } else {
        &app.pipedream_app_slugs
    }
}

/// The catalog entry Macro shows for a Connect app under `app_slug`. Icon
/// paths are relative to the Connect origin.
fn catalog_entry(app: &wire::CatalogEntry, app_slug: &str, api_url: &Url) -> CatalogEntry {
    CatalogEntry {
        app_slug: app_slug.to_owned(),
        display_name: app.name.clone(),
        description: Some(app.description.clone()),
        icon_url: app
            .icon_url
            .as_deref()
            .and_then(|path| api_url.join(path).ok())
            .map(String::from),
        categories: Vec::new(),
        org_setup: app.org_setup.clone().map(|setup| OrgSetup {
            summary: setup.summary,
            steps: setup.steps,
            settings_url: setup.settings_url,
            required: setup.required,
            allowlist_url: setup.allowlist_url,
        }),
    }
}

impl MacroConnect for ConnectAdapter {
    /// The adapter is Connect itself.
    async fn connect_only(&self, _user_id: &MacroUserIdStr<'static>) -> bool {
        true
    }

    #[tracing::instrument(skip(self), err)]
    async fn app_for_slug(&self, app_slug: &str) -> anyhow::Result<Option<ConnectApp>> {
        Ok(self
            .catalog()
            .await?
            .iter()
            .find(|app| macro_slugs(app).iter().any(|slug| slug == app_slug))
            .map(|app| ConnectApp {
                app_id: app.id.clone(),
                app_slug: app_slug.to_owned(),
                name: app.name.clone(),
            }))
    }

    #[tracing::instrument(skip(self, app), err, fields(app_id = %app.app_id))]
    async fn create_connect_session(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app: &ConnectApp,
    ) -> anyhow::Result<String> {
        let mut redirect = self.callback_url.clone();
        redirect
            .query_pairs_mut()
            .append_pair("app_slug", &app.app_slug);
        let session = self
            .client
            .create_connect_session(user_id.as_ref(), &app.app_id, redirect.as_str())
            .await
            .map_err(|error| anyhow::anyhow!("creating Connect session: {error}"))?;
        Ok(session.connect_url)
    }

    #[tracing::instrument(skip(self), err)]
    async fn is_connected(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_id: &str,
    ) -> anyhow::Result<bool> {
        let connections = self
            .client
            .connections(user_id.as_ref())
            .await
            .map_err(|error| anyhow::anyhow!("listing Connect connections: {error}"))?;
        Ok(connections.iter().any(|connection| {
            connection.app_id == app_id
                && matches!(connection.status, wire::ConnectionStatus::Active)
        }))
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_connection(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_id: &str,
    ) -> anyhow::Result<()> {
        match self
            .client
            .delete_connection(user_id.as_ref(), app_id)
            .await
        {
            Ok(_) | Err(connect_client::Error::NotConnected) => Ok(()),
            Err(error) => Err(anyhow::anyhow!("deleting Connect connection: {error}")),
        }
    }
}

impl McpUpstream for ConnectAdapter {
    #[tracing::instrument(skip_all, err, fields(app = %record.app_slug, user_id = %record.user_id))]
    async fn upstream(&self, record: &PipedreamConnection) -> anyhow::Result<McpUpstreamCall> {
        Ok(self.upstream_call(record))
    }
}

impl McpConnection for ConnectAdapter {
    fn is_configured(&self) -> bool {
        true
    }

    #[tracing::instrument(skip_all, err, fields(app = %record.app_slug, user_id = %record.user_id))]
    async fn connect(&self, record: &PipedreamConnection) -> anyhow::Result<McpServer> {
        let upstream = self.upstream_call(record);
        let mut headers = HeaderMap::new();
        let mut auth = HeaderValue::from_str(&format!("Bearer {}", upstream.bearer_token))
            .context("invalid Connect customer key")?;
        auth.set_sensitive(true);
        headers.insert(reqwest::header::AUTHORIZATION, auth);

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .context("building Connect MCP HTTP client")?;
        let config = StreamableHttpClientTransportConfig::with_uri(upstream.url.as_str());
        let transport = StreamableHttpClientTransport::with_client(client, config);
        Ok(client_info().serve(transport).await?)
    }
}

impl ConnectorCapabilities for ConnectAdapter {
    /// Lists tools through the gateway, so only for a user who holds a
    /// Connect connection; anything else is an error the caller falls back
    /// from.
    #[tracing::instrument(skip_all, err)]
    async fn tools(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Vec<ConnectorTool>> {
        let app = self
            .app_for_slug(app_slug)
            .await?
            .with_context(|| format!("Connect does not serve {app_slug}"))?;
        let record = PipedreamConnection {
            user_id: user_id.clone(),
            app_slug: app.app_slug,
            server_name: app.name,
            account_id: app.app_id,
            enabled: true,
            provider: crate::domain::models::ConnectionProvider::Connect,
        };
        tokio::time::timeout(Duration::from_secs(30), async {
            let client = self.connect(&record).await?;
            let tools = client.list_all_tools().await;
            let _ = client.cancel().await;
            Ok(tools?
                .into_iter()
                .map(|tool| ConnectorTool {
                    name: tool.name.into_owned(),
                    description: tool
                        .description
                        .map(|description| description.into_owned())
                        .unwrap_or_default(),
                })
                .collect())
        })
        .await
        .map_err(|_| anyhow::anyhow!("Connector tool discovery timed out; retry later"))?
    }
}

impl ConnectorDirectory for ConnectAdapter {
    /// Connect's catalog under each app's first Macro slug, in catalog
    /// order. `cursor` is an offset.
    #[tracing::instrument(skip(self), err)]
    async fn search(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> anyhow::Result<CatalogPage> {
        let needle = search.map(str::to_lowercase);
        let matching: Vec<CatalogEntry> = self
            .catalog()
            .await?
            .iter()
            .filter(|app| {
                needle
                    .as_deref()
                    .is_none_or(|needle| app.name.to_lowercase().contains(needle))
            })
            .filter_map(|app| {
                let slug = macro_slugs(app).first()?;
                Some(catalog_entry(app, slug, &self.api_url))
            })
            .collect();
        let start: usize = cursor.map(str::parse).transpose()?.unwrap_or(0);
        let end = start.saturating_add(limit as usize).min(matching.len());
        Ok(CatalogPage {
            entries: matching.get(start..end).unwrap_or_default().to_vec(),
            next_cursor: (end < matching.len()).then(|| end.to_string()),
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn retrieve(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Option<CatalogEntry>> {
        Ok(self
            .catalog()
            .await?
            .iter()
            .find(|app| macro_slugs(app).iter().any(|slug| slug == app_slug))
            .map(|app| catalog_entry(app, app_slug, &self.api_url)))
    }
}

impl ConnectedAppProxy for ConnectAdapter {
    /// Calls the app's API directly with the user's exported access token.
    #[tracing::instrument(skip_all, err, fields(app = %connection.app_slug, user_id = %connection.user_id, method = ?method))]
    async fn proxy(
        &self,
        connection: &PipedreamConnection,
        method: http::Method,
        url: &str,
        headers: &http::HeaderMap,
        body: Option<&serde_json::Value>,
    ) -> anyhow::Result<ProxyResponse> {
        let token = self
            .client
            .access_token(connection.user_id.as_ref(), &connection.account_id)
            .await
            .map_err(|error| anyhow::anyhow!("exporting Connect access token: {error}"))?;
        let mut request = self
            .http
            .request(method, url)
            .headers(headers.clone())
            .bearer_auth(&token.access_token);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await.context("calling connected app")?;
        Ok(ProxyResponse {
            status: response.status(),
            headers: response.headers().clone(),
            body: response
                .text()
                .await
                .context("reading connected app response")?,
        })
    }
}
