use crate::domain::models::{
    CatalogEntry, CatalogPage, ConnectApp, ConnectToken, ConnectionProvider, MacroUserIdStr,
    McpServer, PipedreamAccount, PipedreamConnection,
};
use crate::domain::ports::{
    ConnectedAppProxy, ConnectorCapabilities, ConnectorDirectory, MacroConnect, McpConnection,
    PipedreamConnect, ProxyResponse,
};
use crate::domain::service::discovery::ConnectorTool;
use crate::outbound::api::{McpUpstream, McpUpstreamCall, PipedreamClient};
use crate::outbound::connect::ConnectAdapter;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Every connector backend behind one set of ports: Pipedream, plus Macro
/// Connect when configured.
///
/// Calls about a stored connection go to the backend its record names
/// (`provider`). Calls about an app with no record yet stay on Pipedream,
/// except where Connect can answer for a user who holds a Connect
/// connection. Choosing Connect for a new connection is the connect flow's
/// job (the `macro-connect` rollout, see
/// [`start_connect_session`](crate::domain::service::start_connect_session)).
pub struct ConnectorBackends<P = PipedreamClient, C = ConnectAdapter> {
    pipedream: Arc<P>,
    connect: Option<Arc<C>>,
}

impl<P, C> ConnectorBackends<P, C> {
    /// Pipedream alone, or with Connect when `connect` is set.
    pub fn new(pipedream: Arc<P>, connect: Option<Arc<C>>) -> Self {
        Self { pipedream, connect }
    }

    /// The Pipedream backend.
    pub fn pipedream(&self) -> &Arc<P> {
        &self.pipedream
    }

    fn connect_for(&self, record: &PipedreamConnection) -> anyhow::Result<&C> {
        self.connect.as_deref().ok_or_else(|| {
            anyhow::anyhow!(
                "{} is connected through Macro Connect, which is not configured",
                record.app_slug
            )
        })
    }
}

impl<P: McpConnection, C: McpConnection> McpConnection for ConnectorBackends<P, C> {
    fn is_configured(&self) -> bool {
        self.pipedream.is_configured()
    }

    async fn connect(&self, record: &PipedreamConnection) -> anyhow::Result<McpServer> {
        match record.provider {
            ConnectionProvider::Pipedream => self.pipedream.connect(record).await,
            ConnectionProvider::Connect => self.connect_for(record)?.connect(record).await,
        }
    }
}

impl<P: McpUpstream, C: McpUpstream> McpUpstream for ConnectorBackends<P, C> {
    async fn upstream(&self, record: &PipedreamConnection) -> anyhow::Result<McpUpstreamCall> {
        match record.provider {
            ConnectionProvider::Pipedream => self.pipedream.upstream(record).await,
            ConnectionProvider::Connect => self.connect_for(record)?.upstream(record).await,
        }
    }
}

impl<P: ConnectedAppProxy, C: ConnectedAppProxy> ConnectedAppProxy for ConnectorBackends<P, C> {
    async fn proxy(
        &self,
        connection: &PipedreamConnection,
        method: http::Method,
        url: &str,
        headers: &http::HeaderMap,
        body: Option<&serde_json::Value>,
    ) -> anyhow::Result<ProxyResponse> {
        match connection.provider {
            ConnectionProvider::Pipedream => {
                self.pipedream
                    .proxy(connection, method, url, headers, body)
                    .await
            }
            ConnectionProvider::Connect => {
                self.connect_for(connection)?
                    .proxy(connection, method, url, headers, body)
                    .await
            }
        }
    }
}

impl<P: PipedreamConnect, C: Send + Sync + 'static> PipedreamConnect for ConnectorBackends<P, C> {
    async fn create_connect_token(&self, external_user_id: &str) -> anyhow::Result<ConnectToken> {
        self.pipedream.create_connect_token(external_user_id).await
    }

    async fn get_account(&self, account_id: &str) -> anyhow::Result<Option<PipedreamAccount>> {
        self.pipedream.get_account(account_id).await
    }

    async fn list_accounts(
        &self,
        external_user_id: &str,
        app_slug: &str,
    ) -> anyhow::Result<Vec<PipedreamAccount>> {
        self.pipedream
            .list_accounts(external_user_id, app_slug)
            .await
    }

    async fn delete_account(&self, account_id: &str) -> anyhow::Result<()> {
        self.pipedream.delete_account(account_id).await
    }
}

impl<P: ConnectorDirectory, C: ConnectorDirectory> ConnectorDirectory for ConnectorBackends<P, C> {
    /// Pipedream's directory: a superset of Connect's catalog under the same
    /// slugs, ranked by popularity and categorized.
    async fn search(
        &self,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> anyhow::Result<CatalogPage> {
        self.pipedream.search(search, cursor, limit).await
    }

    /// Pipedream's entry, else Connect's, so a Connect-only slug still
    /// verifies.
    async fn retrieve(&self, app_slug: &str) -> anyhow::Result<Option<CatalogEntry>> {
        if let Some(entry) = self.pipedream.retrieve(app_slug).await? {
            return Ok(Some(entry));
        }
        match &self.connect {
            Some(connect) => connect.retrieve(app_slug).await,
            None => Ok(None),
        }
    }
}

impl<P, C> ConnectorCapabilities for ConnectorBackends<P, C>
where
    P: ConnectorCapabilities,
    C: ConnectorCapabilities + MacroConnect,
{
    /// The app's tools through Connect's gateway when the user holds a
    /// Connect connection to it, otherwise Pipedream's listing, which needs
    /// no connection.
    async fn tools(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Vec<ConnectorTool>> {
        if let Some(connect) = &self.connect
            && matches!(connect.app_for_slug(app_slug).await, Ok(Some(_)))
        {
            match connect.tools(user_id, app_slug).await {
                Ok(tools) => return Ok(tools),
                Err(error) => {
                    tracing::debug!(error = ?error, app_slug, "no Connect tool listing; using Pipedream's");
                }
            }
        }
        self.pipedream.tools(user_id, app_slug).await
    }
}

impl<P: Send + Sync + 'static, C: MacroConnect> MacroConnect for ConnectorBackends<P, C> {
    async fn app_for_slug(&self, app_slug: &str) -> anyhow::Result<Option<ConnectApp>> {
        match &self.connect {
            Some(connect) => connect.app_for_slug(app_slug).await,
            None => Ok(None),
        }
    }

    async fn create_connect_session(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app: &ConnectApp,
    ) -> anyhow::Result<String> {
        match &self.connect {
            Some(connect) => connect.create_connect_session(user_id, app).await,
            None => anyhow::bail!("Macro Connect is not configured"),
        }
    }

    async fn is_connected(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_id: &str,
    ) -> anyhow::Result<bool> {
        match &self.connect {
            Some(connect) => connect.is_connected(user_id, app_id).await,
            None => Ok(false),
        }
    }

    async fn delete_connection(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_id: &str,
    ) -> anyhow::Result<()> {
        match &self.connect {
            Some(connect) => connect.delete_connection(user_id, app_id).await,
            None => anyhow::bail!("Macro Connect is not configured"),
        }
    }
}
