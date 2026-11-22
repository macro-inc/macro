use crate::domain::models::ApiRequest;
use crate::outbound::hosted_connections::RevokeGrant;
use crate::outbound::macro_connect::{ConnectVendor, ConnectVendorClient};
use crate::outbound::pipedream::domain::models::{
    CatalogEntry, CatalogPage, ConnectApp, MacroUserIdStr, McpServer, PipedreamConnection,
};
use crate::outbound::pipedream::domain::ports::{
    ConnectedAppProxy, ConnectorCapabilities, ConnectorDirectory, MacroConnect, McpConnection,
    ProxyResponse,
};
use crate::outbound::pipedream::domain::service::discovery::ConnectorTool;
use crate::outbound::pipedream::outbound::api::{McpUpstream, McpUpstreamCall};
use anyhow::Context;
use connect_client::wire;
use reqwest::header::HeaderMap;
use std::sync::Arc;
use std::time::Duration;
use url::Url;

pub use crate::outbound::macro_connect::ConnectConfig;

/// Macro Connect behind this crate's ports, over `connect_client`.
///
/// Transitional: what the old Pipedream routes and hosts use until they move
/// to the connectors services. Connect's mechanics live in
/// [`crate::outbound::macro_connect`]; this only adapts them to the old
/// ports, for records with [`ConnectionProvider::Connect`]. Catalog apps are
/// addressed by the Pipedream slugs they replace, or by their Connect id when
/// Pipedream has no such app.
///
/// [`ConnectionProvider::Connect`]: crate::outbound::pipedream::domain::models::ConnectionProvider::Connect
pub struct ConnectAdapter {
    vendor: ConnectVendorClient,
}

impl ConnectAdapter {
    /// Build an adapter. Fails when the base URL is not an HTTP URL.
    pub fn new(config: ConnectConfig) -> anyhow::Result<Self> {
        Ok(Self {
            vendor: ConnectVendorClient::new(config)?,
        })
    }

    async fn catalog(&self) -> anyhow::Result<Arc<Vec<wire::CatalogEntry>>> {
        Ok(self.vendor.catalog().await?)
    }

    fn upstream_call(&self, record: &PipedreamConnection) -> McpUpstreamCall {
        let upstream = self.vendor.upstream(&record.user_id, &record.account_id);
        McpUpstreamCall {
            url: upstream.url().clone(),
            bearer_token: upstream.bearer().unwrap_or_default().to_owned(),
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
        let url = self
            .vendor
            .connect_url(user_id, &app.app_id, &app.app_slug)
            .await?;
        Ok(url.into())
    }

    #[tracing::instrument(skip(self), err)]
    async fn is_connected(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_id: &str,
    ) -> anyhow::Result<bool> {
        let connections = self.vendor.connections(user_id).await?;
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
        Ok(self.vendor.revoke(user_id, app_id).await?)
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
        Ok(self
            .vendor
            .dial(&record.user_id, &record.account_id)
            .await?)
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
            provider: crate::outbound::pipedream::domain::models::ConnectionProvider::Connect,
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
                Some(catalog_entry(app, slug, self.vendor.api_url()))
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
            .map(|app| catalog_entry(app, app_slug, self.vendor.api_url())))
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
        let request = ApiRequest {
            method,
            url: url.to_owned(),
            headers: headers.clone(),
            body: body.cloned(),
        };
        let response = self
            .vendor
            .call(&connection.user_id, &connection.account_id, request)
            .await?;
        Ok(ProxyResponse {
            status: response.status,
            headers: response.headers,
            body: response.body,
        })
    }
}
