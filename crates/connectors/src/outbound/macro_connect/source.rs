//! Macro Connect as a [`Source`].

use crate::domain::catalog;
use crate::domain::models::{
    ApiRequest, ApiResponse, ConnectStep, ConnectorId, ConnectorKey, Surfaces, Upstream,
};
use crate::domain::ports::{
    ApiConnection, GrantState, McpConnection, Source, SourceConnection, SourceKind, SourceRefusal,
};
use crate::outbound::hosted_connections::{
    Grant, HostedRepo, HostedRow, Provider, RevokeGrant, revoke_replaced,
};
use crate::outbound::macro_connect::vendor::ConnectVendor;
use connect_client::wire;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_toolset::McpServer;
use rootcause::Report;
use std::collections::HashMap;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// The access method Connect's catalog lists for MCP tools.
const ACCESS_MCP: &str = "mcp";

/// The access method Connect's catalog lists for the app's own API.
const ACCESS_API: &str = "api";

/// The slugs Macro addresses a Connect app by: the Pipedream slugs it
/// replaces, or its Connect id when it replaces none.
fn macro_slugs(entry: &wire::CatalogEntry) -> &[String] {
    if entry.pipedream_app_slugs.is_empty() {
        std::slice::from_ref(&entry.id)
    } else {
        &entry.pipedream_app_slugs
    }
}

/// Whether Macro addresses `entry` as `app`.
fn serves(entry: &wire::CatalogEntry, app: &ConnectorId) -> bool {
    macro_slugs(entry)
        .iter()
        .any(|slug| ConnectorId::parse(slug).is_ok_and(|id| id == *app))
}

/// What Connect's catalog lists for `entry`.
fn surfaces(entry: &wire::CatalogEntry) -> Surfaces {
    let lists = |method: &str| entry.access.iter().any(|access| access == method);
    Surfaces::new(lists(ACCESS_MCP), lists(ACCESS_API))
}

/// The catalog app a key names, or the refusal for a server added by URL.
fn app_of(key: &ConnectorKey) -> Result<&ConnectorId, Report> {
    match key {
        ConnectorKey::App(app) => Ok(app),
        ConnectorKey::Server(_) => {
            Err(Report::new(SourceRefusal::Unsupported(key.clone())).into_dynamic())
        }
    }
}

fn refusal(refusal: SourceRefusal) -> Report {
    Report::new(refusal).into_dynamic()
}

/// Macro Connect as a [`Source`].
pub(crate) struct ConnectSource {
    vendor: Arc<dyn ConnectVendor>,
    repo: HostedRepo,
    /// Revokes a Pipedream grant a completed Connect connection replaced;
    /// `None` where Pipedream is not configured.
    pipedream_grants: Option<Arc<dyn RevokeGrant>>,
}

impl ConnectSource {
    /// A source over `vendor` and the Connect rows of `repo`.
    pub(crate) fn new(
        vendor: Arc<dyn ConnectVendor>,
        repo: HostedRepo,
        pipedream_grants: Option<Arc<dyn RevokeGrant>>,
    ) -> Self {
        Self {
            vendor,
            repo,
            pipedream_grants,
        }
    }

    /// The catalog entry Macro addresses as `app`.
    async fn entry(&self, app: &ConnectorId) -> Result<Option<wire::CatalogEntry>, Report> {
        Ok(self
            .vendor
            .catalog()
            .await?
            .iter()
            .find(|entry| serves(entry, app))
            .cloned())
    }

    /// `row` as a connection, given Connect's catalog and the status Connect
    /// reports for each of the user's apps.
    fn connection(
        &self,
        row: HostedRow,
        catalog: &[wire::CatalogEntry],
        statuses: &HashMap<String, wire::ConnectionStatus>,
    ) -> Result<SourceConnection, Report> {
        let app = ConnectorId::parse(&row.app_slug).map_err(Report::new)?;
        let key = ConnectorKey::App(app);

        // A Connect row stores Connect's app id as its account. Connect
        // provides the API only where its catalog lists API access.
        let provides_api = catalog
            .iter()
            .find(|entry| entry.id == row.account_id)
            .is_some_and(|entry| surfaces(entry).api());
        let grant = match statuses.get(&row.account_id) {
            Some(wire::ConnectionStatus::Active) => GrantState::Working,
            _ => GrantState::Dead,
        };
        let connection = Arc::new(ConnectApp {
            vendor: self.vendor.clone(),
            user: row.user,
            app_id: row.account_id,
            key: key.clone(),
        });

        Ok(SourceConnection {
            source: SourceKind::Connect,
            key,
            source_id: row.app_slug,
            name: row.server_name,
            enabled: row.enabled,
            grant,
            mcp: Some(connection.clone()),
            api: provides_api.then_some(connection as Arc<dyn ApiConnection>),
        })
    }
}

#[async_trait::async_trait]
impl Source for ConnectSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Connect
    }

    /// The user's Connect rows, authorized while Connect reports their grant
    /// active. Connect is asked only when the user holds a Connect row.
    #[tracing::instrument(skip_all, err)]
    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<SourceConnection>, Report> {
        let rows = self.repo.list(user).await?;
        if rows.is_empty() {
            return Ok(Vec::new());
        }

        let catalog = self.vendor.catalog().await?;
        let statuses: HashMap<String, wire::ConnectionStatus> = self
            .vendor
            .connections(user)
            .await?
            .into_iter()
            .map(|connection| (connection.app_id, connection.status))
            .collect();

        // A row under a slug that is not one cannot be any app; skip it
        // rather than fail every other connection.
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                self.connection(row, &catalog, &statuses)
                    .inspect_err(
                        |error| tracing::warn!(error = ?error, "skipping a malformed Connect row"),
                    )
                    .ok()
            })
            .collect())
    }

    /// From Connect's catalog, cached, with the access methods it lists.
    #[tracing::instrument(skip(self), fields(app = %app), err)]
    async fn supports(&self, app: &ConnectorId) -> Result<Option<Surfaces>, Report> {
        Ok(self.entry(app).await?.as_ref().map(surfaces))
    }

    #[tracing::instrument(skip(self), fields(app = %app), err)]
    async fn holders(&self, app: &ConnectorId) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.repo.holders(&catalog::slugs_of(app)).await
    }

    /// Connect's consent page for the app.
    #[tracing::instrument(skip(self, user), fields(key = %key), err)]
    async fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep, Report> {
        let app = app_of(key)?;
        let entry = self
            .entry(app)
            .await?
            .ok_or_else(|| refusal(SourceRefusal::Unsupported(key.clone())))?;

        let url = self
            .vendor
            .connect_url(user, &entry.id, app.as_str())
            .await?;
        Ok(ConnectStep::OpenUrl(url))
    }

    /// Record the connection Connect holds for the user to `app`.
    ///
    /// Nothing the browser reports is trusted: Connect itself must list an
    /// active connection for this user. The row is stored under the app's
    /// slug and turned on, replacing whatever row the user held for the app,
    /// and the Pipedream grant it replaced is revoked.
    #[tracing::instrument(skip(self, user), fields(app = %app), err)]
    async fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<SourceConnection, Report> {
        let key = ConnectorKey::App(app.clone());
        let entry = self
            .entry(app)
            .await?
            .ok_or_else(|| refusal(SourceRefusal::Unsupported(key.clone())))?;

        let held = self
            .vendor
            .connections(user)
            .await?
            .into_iter()
            .find(|connection| connection.app_id == entry.id);
        match held.map(|connection| connection.status) {
            Some(wire::ConnectionStatus::Active) => {}
            Some(wire::ConnectionStatus::NeedsReauth) => {
                return Err(refusal(SourceRefusal::NeedsReauth(key)));
            }
            None => return Err(refusal(SourceRefusal::NotFound(key))),
        }

        let row = HostedRow {
            user: user.clone(),
            app_slug: app.as_str().to_owned(),
            server_name: entry.name.clone(),
            account_id: entry.id.clone(),
            enabled: true,
        };
        let replaced = self.repo.replace(&row, &catalog::slugs_of(app)).await?;
        let kept = Grant {
            provider: Provider::Connect,
            account_id: row.account_id.clone(),
        };
        revoke_replaced(user, &kept, replaced, |provider| match provider {
            Provider::Connect => Some(self.vendor.clone() as Arc<dyn RevokeGrant>),
            Provider::Pipedream => self.pipedream_grants.clone(),
        })
        .await;

        self.connections(user)
            .await?
            .into_iter()
            .find(|connection| connection.key == key)
            .ok_or_else(|| rootcause::report!("the stored Connect row disappeared"))
    }

    #[tracing::instrument(skip(self, user), fields(key = %key), err)]
    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> Result<(), Report> {
        let app = app_of(key)?;
        let changed = self
            .repo
            .set_enabled(user, &catalog::slugs_of(app), enabled)
            .await?;
        if changed == 0 {
            return Err(refusal(SourceRefusal::NotFound(key.clone())));
        }

        Ok(())
    }

    #[tracing::instrument(skip(self, user, name), fields(key = %key), err)]
    async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> Result<(), Report> {
        let app = app_of(key)?;
        let changed = self
            .repo
            .rename(user, &catalog::slugs_of(app), name)
            .await?;
        if changed == 0 {
            return Err(refusal(SourceRefusal::NotFound(key.clone())));
        }

        Ok(())
    }

    /// Delete the user's Connect connections for the app, then the rows.
    /// Deleting at Connect is best effort and safe to repeat, so a failure
    /// there never strands the row.
    #[tracing::instrument(skip(self, user), fields(key = %key), err)]
    async fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<(), Report> {
        let app = app_of(key)?;
        let slugs = catalog::slugs_of(app);
        let held = self.repo.list(user).await?;

        for row in held
            .iter()
            .filter(|row| slugs.contains(&row.app_slug.as_str()))
        {
            let _ = self.vendor.revoke(user, &row.account_id).await.inspect_err(
                |error| tracing::warn!(error = ?error, "failed to delete the Connect connection"),
            );
        }

        self.repo.delete(user, &slugs).await
    }
}

/// One Connect connection, used for MCP and, where the catalog lists it, for
/// its app's API.
struct ConnectApp {
    vendor: Arc<dyn ConnectVendor>,
    user: MacroUserIdStr<'static>,
    app_id: String,
    key: ConnectorKey,
}

#[async_trait::async_trait]
impl McpConnection for ConnectApp {
    async fn dial(&self) -> Result<McpServer, Report> {
        self.vendor.dial(&self.user, &self.app_id).await
    }

    async fn upstream(&self) -> Result<Upstream, Report> {
        Ok(self.vendor.upstream(&self.user, &self.app_id))
    }
}

#[async_trait::async_trait]
impl ApiConnection for ConnectApp {
    /// A grant Connect can no longer export is one the user must authorize
    /// again.
    async fn call(&self, request: ApiRequest) -> Result<ApiResponse, Report> {
        self.vendor
            .call(&self.user, &self.app_id, request)
            .await
            .map_err(
                |error| match error.downcast_current_context::<connect_client::Error>() {
                    Some(
                        connect_client::Error::NeedsReauth | connect_client::Error::NotConnected,
                    ) => refusal(SourceRefusal::NeedsReauth(self.key.clone())),
                    _ => error,
                },
            )
    }
}
