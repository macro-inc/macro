use crate::domain::models::{
    CatalogEntry, CatalogPage, ConnectApp, ConnectToken, ConnectionProvider, MacroUserIdStr,
    McpServer, PipedreamAccount, PipedreamConnection,
};
use crate::domain::ports::{
    ConnectRollout, ConnectedAppProxy, ConnectorCapabilities, ConnectorDirectory, MacroConnect,
    McpConnection, PipedreamConnect, ProxyResponse,
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
/// A user the `macro-connect` rollout is on for is on Connect alone
/// ([`MacroConnect::connect_only`]): directory, tool listings, and every
/// stored connection go through Connect, and a Pipedream connection they
/// still hold is refused until they reconnect the app through Connect.
/// Nothing falls back to Pipedream. Everyone else stays on Pipedream, except
/// that a stored Connect connection always reaches Connect.
pub struct ConnectorBackends<P = PipedreamClient, C = ConnectAdapter> {
    pipedream: Arc<P>,
    connect: Option<Arc<C>>,
    rollout: Option<ConnectRollout>,
}

impl<P, C> ConnectorBackends<P, C> {
    /// Pipedream alone, or with Connect when `connect` is set. Nobody is on
    /// Connect alone until [`with_rollout`](Self::with_rollout).
    pub fn new(pipedream: Arc<P>, connect: Option<Arc<C>>) -> Self {
        Self {
            pipedream,
            connect,
            rollout: None,
        }
    }

    /// Put users `rollout` answers `true` for on Connect alone.
    pub fn with_rollout(mut self, rollout: ConnectRollout) -> Self {
        self.rollout = Some(rollout);
        self
    }

    /// The Pipedream backend.
    pub fn pipedream(&self) -> &Arc<P> {
        &self.pipedream
    }

    /// Connect, when `user_id` is on Connect alone.
    async fn connect_for_user(&self, user_id: &MacroUserIdStr<'static>) -> Option<&C> {
        let (Some(connect), Some(rollout)) = (&self.connect, &self.rollout) else {
            return None;
        };
        rollout(user_id.clone()).await.then_some(connect.as_ref())
    }

    /// The backend `record` names. A Pipedream record of a user on Connect
    /// alone is refused rather than used.
    async fn backend_for(&self, record: &PipedreamConnection) -> anyhow::Result<Backend<'_, P, C>> {
        match record.provider {
            ConnectionProvider::Connect => self
                .connect
                .as_deref()
                .map(Backend::Connect)
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "{} is connected through Macro Connect, which is not configured",
                        record.app_slug
                    )
                }),
            ConnectionProvider::Pipedream => {
                if self.connect_for_user(&record.user_id).await.is_some() {
                    anyhow::bail!(
                        "{} is connected through Pipedream; reconnect it through Macro Connect",
                        record.app_slug
                    );
                }
                Ok(Backend::Pipedream(&self.pipedream))
            }
        }
    }
}

enum Backend<'a, P, C> {
    Pipedream(&'a P),
    Connect(&'a C),
}

impl<P: McpConnection, C: McpConnection> McpConnection for ConnectorBackends<P, C> {
    fn is_configured(&self) -> bool {
        self.pipedream.is_configured()
    }

    async fn connect(&self, record: &PipedreamConnection) -> anyhow::Result<McpServer> {
        match self.backend_for(record).await? {
            Backend::Pipedream(pipedream) => pipedream.connect(record).await,
            Backend::Connect(connect) => connect.connect(record).await,
        }
    }
}

impl<P: McpUpstream, C: McpUpstream> McpUpstream for ConnectorBackends<P, C> {
    async fn upstream(&self, record: &PipedreamConnection) -> anyhow::Result<McpUpstreamCall> {
        match self.backend_for(record).await? {
            Backend::Pipedream(pipedream) => pipedream.upstream(record).await,
            Backend::Connect(connect) => connect.upstream(record).await,
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
        match self.backend_for(connection).await? {
            Backend::Pipedream(pipedream) => {
                pipedream
                    .proxy(connection, method, url, headers, body)
                    .await
            }
            Backend::Connect(connect) => {
                connect.proxy(connection, method, url, headers, body).await
            }
        }
    }
}

/// Pipedream's own account API, for users still on Pipedream; callers check
/// [`MacroConnect::connect_only`] first.
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
    /// Connect's catalog for a user on Connect alone, else Pipedream's
    /// directory.
    async fn search(
        &self,
        user_id: &MacroUserIdStr<'static>,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> anyhow::Result<CatalogPage> {
        match self.connect_for_user(user_id).await {
            Some(connect) => connect.search(user_id, search, cursor, limit).await,
            None => self.pipedream.search(user_id, search, cursor, limit).await,
        }
    }

    /// From the same directory as [`search`](Self::search).
    async fn retrieve(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Option<CatalogEntry>> {
        match self.connect_for_user(user_id).await {
            Some(connect) => connect.retrieve(user_id, app_slug).await,
            None => self.pipedream.retrieve(user_id, app_slug).await,
        }
    }
}

impl<P: ConnectorCapabilities, C: ConnectorCapabilities> ConnectorCapabilities
    for ConnectorBackends<P, C>
{
    /// Connect's gateway listing for a user on Connect alone (which needs
    /// their Connect connection), else Pipedream's, which needs none.
    async fn tools(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Vec<ConnectorTool>> {
        match self.connect_for_user(user_id).await {
            Some(connect) => connect.tools(user_id, app_slug).await,
            None => self.pipedream.tools(user_id, app_slug).await,
        }
    }
}

impl<P: Send + Sync + 'static, C: MacroConnect> MacroConnect for ConnectorBackends<P, C> {
    async fn connect_only(&self, user_id: &MacroUserIdStr<'static>) -> bool {
        self.connect_for_user(user_id).await.is_some()
    }

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
