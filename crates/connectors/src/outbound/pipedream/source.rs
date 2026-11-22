//! Pipedream as a source of connections: the rows with `provider =
//! 'pipedream'`, served through Pipedream Connect, its remote MCP server and
//! its Connect API proxy.

use crate::domain::catalog;
use crate::domain::models::{
    ApiRequest, ApiResponse, ConnectStep, ConnectorId, ConnectorKey, Surfaces, Upstream,
};
use crate::domain::ports::{
    ApiConnection, McpConnection, Source, SourceConnection, SourceKind, SourceRefusal,
};
use crate::outbound::hosted_connections::{
    Grant, HostedRepo, HostedRow, Provider, RevokeGrant, revoke_replaced,
};
use crate::outbound::pipedream::api::{McpUpstreamCall, PipedreamClient};
use crate::outbound::pipedream::models::{
    CatalogEntry, ConnectToken, PipedreamAccount, PipedreamConnection,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_toolset::McpServer;
use rootcause::Report;
use rootcause::compat::IntoRootcause;
use std::sync::Arc;
use url::Url;

#[cfg(test)]
mod test;

/// What the Pipedream source needs from Pipedream.
///
/// `#[async_trait]` because the source and every connection it hands out
/// share one `Arc<dyn PipedreamVendor>`.
#[async_trait::async_trait]
pub(crate) trait PipedreamVendor: RevokeGrant {
    /// Pipedream's connectable app under `slug`, if there is one.
    async fn app(&self, slug: &str) -> Result<Option<CatalogEntry>, Report>;

    /// A short-lived token that opens Pipedream's hosted connect dialog for
    /// the user.
    async fn connect_token(&self, user: &MacroUserIdStr<'static>) -> Result<ConnectToken, Report>;

    /// The accounts Pipedream holds for the user to `slug`.
    async fn accounts(
        &self,
        user: &MacroUserIdStr<'static>,
        slug: &str,
    ) -> Result<Vec<PipedreamAccount>, Report>;

    /// Open an MCP session on Pipedream's remote server for `record`.
    async fn dial(&self, record: &PipedreamConnection) -> Result<McpServer, Report>;

    /// How to address Pipedream's remote server for `record`.
    async fn upstream(&self, record: &PipedreamConnection) -> Result<McpUpstreamCall, Report>;

    /// Call `record`'s app API through Pipedream's Connect proxy.
    async fn proxy(
        &self,
        record: &PipedreamConnection,
        request: ApiRequest,
    ) -> Result<ApiResponse, Report>;
}

#[async_trait::async_trait]
impl RevokeGrant for PipedreamClient {
    async fn revoke(
        &self,
        _user: &MacroUserIdStr<'static>,
        account_id: &str,
    ) -> Result<(), Report> {
        self.delete_account(account_id).await.into_rootcause()
    }
}

#[async_trait::async_trait]
impl PipedreamVendor for PipedreamClient {
    async fn app(&self, slug: &str) -> Result<Option<CatalogEntry>, Report> {
        self.retrieve_app(slug).await.into_rootcause()
    }

    async fn connect_token(&self, user: &MacroUserIdStr<'static>) -> Result<ConnectToken, Report> {
        self.create_connect_token(user.as_ref())
            .await
            .into_rootcause()
    }

    async fn accounts(
        &self,
        user: &MacroUserIdStr<'static>,
        slug: &str,
    ) -> Result<Vec<PipedreamAccount>, Report> {
        self.list_accounts(user.as_ref(), slug)
            .await
            .into_rootcause()
    }

    async fn dial(&self, record: &PipedreamConnection) -> Result<McpServer, Report> {
        self.dial_mcp(record).await.into_rootcause()
    }

    async fn upstream(&self, record: &PipedreamConnection) -> Result<McpUpstreamCall, Report> {
        self.mcp_upstream(record).await.into_rootcause()
    }

    async fn proxy(
        &self,
        record: &PipedreamConnection,
        request: ApiRequest,
    ) -> Result<ApiResponse, Report> {
        PipedreamClient::proxy(self, record, request)
            .await
            .into_rootcause()
    }
}

/// The Pipedream slug a new connection to `app` is made under.
///
/// An alias names the app's newer Pipedream app (`slack_v2` for `slack`),
/// which is the one Pipedream offers to connect; the app's own slug
/// otherwise.
fn connect_slug(app: &ConnectorId) -> &str {
    let slugs = catalog::slugs_of(app);
    slugs.last().copied().unwrap_or(app.as_str())
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

/// Pipedream as a [`Source`].
pub(crate) struct PipedreamSource {
    vendor: Arc<dyn PipedreamVendor>,
    repo: HostedRepo,
    /// Revokes a Macro Connect grant a completed Pipedream connection
    /// replaced; `None` where Connect is not configured.
    connect_grants: Option<Arc<dyn RevokeGrant>>,
}

impl PipedreamSource {
    /// A source over `vendor` and the Pipedream rows of `repo`.
    pub(crate) fn new(
        vendor: Arc<dyn PipedreamVendor>,
        repo: HostedRepo,
        connect_grants: Option<Arc<dyn RevokeGrant>>,
    ) -> Self {
        Self {
            vendor,
            repo,
            connect_grants,
        }
    }

    fn connection(&self, row: HostedRow) -> Result<SourceConnection, Report> {
        let app = ConnectorId::parse(&row.app_slug).map_err(Report::new)?;
        let record = PipedreamConnection {
            user_id: row.user,
            app_slug: row.app_slug.clone(),
            server_name: row.server_name.clone(),
            account_id: row.account_id,
            enabled: row.enabled,
        };
        let connection = Arc::new(PipedreamApp {
            vendor: self.vendor.clone(),
            record,
        });

        Ok(SourceConnection {
            source: SourceKind::Pipedream,
            key: ConnectorKey::App(app),
            source_id: row.app_slug,
            name: row.server_name,
            enabled: row.enabled,
            // Pipedream refreshes its grants itself and reports no failed
            // one without a call per account.
            authorized: true,
            mcp: Some(connection.clone()),
            api: Some(connection),
        })
    }
}

#[async_trait::async_trait]
impl Source for PipedreamSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Pipedream
    }

    #[tracing::instrument(skip_all, err)]
    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<SourceConnection>, Report> {
        let rows = self.repo.list(user).await?;

        // A row under a slug that is not one cannot be any app; skip it
        // rather than fail every other connection.
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                self.connection(row)
                    .inspect_err(|error| tracing::warn!(error = ?error, "skipping a malformed Pipedream row"))
                    .ok()
            })
            .collect())
    }

    /// Every app in Pipedream's directory, with MCP tools and its REST API.
    #[tracing::instrument(skip(self), fields(app = %app), err)]
    async fn supports(&self, app: &ConnectorId) -> Result<Option<Surfaces>, Report> {
        let listed = self.vendor.app(connect_slug(app)).await?;
        Ok(listed.map(|_| Surfaces::new(true, true)))
    }

    #[tracing::instrument(skip(self), fields(app = %app), err)]
    async fn holders(&self, app: &ConnectorId) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.repo.holders(&catalog::slugs_of(app)).await
    }

    /// Pipedream's hosted connect dialog, opened on the app's Pipedream slug.
    #[tracing::instrument(skip(self, user), fields(key = %key), err)]
    async fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep, Report> {
        let app = app_of(key)?;
        let token = self.vendor.connect_token(user).await?;

        // The link opens the same flow in a tab, deep-linked to the app.
        let mut link = Url::parse(&token.connect_link_url).map_err(Report::new)?;
        link.query_pairs_mut().append_pair("app", connect_slug(app));

        Ok(ConnectStep::EmbeddedDialog {
            token: token.token,
            expires_at: token.expires_at,
            link,
        })
    }

    /// Record the account Pipedream holds for the user to `app`.
    ///
    /// Nothing the browser reports is trusted: Pipedream lists the accounts
    /// connected for this user, and the newest one to any of the app's
    /// slugs is stored and turned on, replacing whatever row the user held
    /// for the app.
    #[tracing::instrument(skip(self, user), fields(app = %app), err)]
    async fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<SourceConnection, Report> {
        let slugs = catalog::slugs_of(app);
        let mut accounts = Vec::new();
        for slug in &slugs {
            accounts.extend(self.vendor.accounts(user, slug).await?);
        }
        let newest = accounts
            .into_iter()
            .filter(|account| account.external_user_id.as_deref() == Some(user.as_ref()))
            .max_by_key(|account| account.created_at)
            .ok_or_else(|| {
                Report::new(SourceRefusal::NotFound(ConnectorKey::App(app.clone()))).into_dynamic()
            })?;

        let row = HostedRow {
            user: user.clone(),
            app_slug: newest.app_slug,
            server_name: newest.app_name,
            account_id: newest.id,
            enabled: true,
        };
        let replaced = self.repo.replace(&row, &slugs).await?;
        let kept = Grant {
            provider: Provider::Pipedream,
            account_id: row.account_id.clone(),
        };
        revoke_replaced(user, &kept, replaced, |provider| match provider {
            Provider::Pipedream => Some(self.vendor.clone() as Arc<dyn RevokeGrant>),
            Provider::Connect => self.connect_grants.clone(),
        })
        .await;

        let stored = self
            .repo
            .list(user)
            .await?
            .into_iter()
            .find(|stored| stored.app_slug == row.app_slug)
            .ok_or_else(|| rootcause::report!("the stored Pipedream row disappeared"))?;
        self.connection(stored)
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
            return Err(Report::new(SourceRefusal::NotFound(key.clone())).into_dynamic());
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
            return Err(Report::new(SourceRefusal::NotFound(key.clone())).into_dynamic());
        }

        Ok(())
    }

    /// Revoke the user's Pipedream accounts for the app, then delete the
    /// rows. Revoking is best effort and safe to repeat, so a failure there
    /// never strands the row.
    #[tracing::instrument(skip(self, user), fields(key = %key), err)]
    async fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<(), Report> {
        let app = app_of(key)?;
        let slugs = catalog::slugs_of(app);
        let held: Vec<HostedRow> = self
            .repo
            .list(user)
            .await?
            .into_iter()
            .filter(|row| slugs.contains(&row.app_slug.as_str()))
            .collect();

        for row in &held {
            let _ = self.vendor.revoke(user, &row.account_id).await.inspect_err(
                |error| tracing::warn!(error = ?error, "failed to delete the Pipedream account"),
            );
        }

        self.repo.delete(user, &slugs).await
    }
}

/// One Pipedream connection, used for MCP and for its app's API.
struct PipedreamApp {
    vendor: Arc<dyn PipedreamVendor>,
    record: PipedreamConnection,
}

#[async_trait::async_trait]
impl McpConnection for PipedreamApp {
    async fn dial(&self) -> Result<McpServer, Report> {
        self.vendor.dial(&self.record).await
    }

    async fn upstream(&self) -> Result<Upstream, Report> {
        let call = self.vendor.upstream(&self.record).await?;
        Ok(Upstream::new(
            call.url,
            Some(call.bearer_token),
            call.headers,
        ))
    }
}

#[async_trait::async_trait]
impl ApiConnection for PipedreamApp {
    async fn call(&self, request: ApiRequest) -> Result<ApiResponse, Report> {
        self.vendor.proxy(&self.record, request).await
    }
}
