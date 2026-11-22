//! The native source: MCP servers a user connects to directly by URL, held
//! in `mcp_servers` and dialed with Macro's own OAuth client.
//!
//! Every row reports the server's address, never an app: whether a URL is an
//! overlaid app's server is the resolver's call (rule 5). GitHub's server is
//! left out, because the account link source owns GitHub, and a row at its
//! address only stores that link's enabled toggle and name.

use crate::domain::models::{AddedBy, ConnectStep, ConnectorId, ConnectorKey, ServerUrl, Upstream};
use crate::domain::ports::{McpConnection, Source, SourceConnection, SourceKind, SourceRefusal};
use crate::outbound::native::domain::models::{
    GITHUB_MCP_SERVER_URL, MacroUserIdStr, McpServer, McpServerRecord,
};
use crate::outbound::native::domain::ports::{McpConnector, McpServerStore, OAuthClient};
use crate::outbound::native::domain::service::{
    self as native_service, AddServerError, ServerAccess, ServerDirectory, server_access,
};
use crate::outbound::native::outbound::guarded_http::McpHttp;
use rmcp::transport::auth::AuthError;
use rootcause::Report;
use rootcause::compat::IntoRootcause as _;
use std::sync::Arc;
use url::Url;

#[cfg(test)]
mod test;

/// The servers users connect to directly.
pub(crate) struct NativeSource<S, O> {
    store: Arc<S>,
    oauth: Arc<O>,
    http: McpHttp,
}

impl<S, O> NativeSource<S, O>
where
    S: McpServerStore,
    O: OAuthClient,
    anyhow::Error: From<S::Err>,
{
    /// A source over the `mcp_servers` rows in `store`, signing in through
    /// `oauth` and dialing through `http`.
    pub(crate) fn new(store: Arc<S>, oauth: Arc<O>, http: McpHttp) -> Self {
        Self { store, oauth, http }
    }

    /// Add `url` to the user's servers under `name`, enabled and not yet
    /// signed in to. A URL the user already has, in any spelling, is
    /// returned as it stands: saving over it would wipe its grant.
    ///
    /// An agent may only add a public `https` server
    /// ([`SourceRefusal::NonPublic`]); an empty name is
    /// [`SourceRefusal::EmptyName`].
    #[tracing::instrument(skip(self, user, name), err)]
    pub(crate) async fn add_server(
        &self,
        user: &MacroUserIdStr<'static>,
        url: &ServerUrl,
        name: &str,
        added_by: AddedBy,
    ) -> Result<SourceConnection, Report> {
        if let Some((url, record)) = self
            .rows(user)
            .await?
            .into_iter()
            .find(|(held, _)| held == url)
        {
            return Ok(self.connection(url, record));
        }

        let added_by = match added_by {
            AddedBy::User => native_service::AddedBy::User,
            AddedBy::Agent => native_service::AddedBy::Agent,
        };
        let added = ServerDirectory::new(self.store.clone())
            .add(user.clone(), url.as_str(), name, added_by)
            .await
            .map_err(|error| match error {
                AddServerError::NonPublicDestination(_) => {
                    Report::from(SourceRefusal::NonPublic(url.clone()))
                }
                AddServerError::EmptyName => Report::from(SourceRefusal::EmptyName),
                AddServerError::InvalidUrl(_) => Report::from(error),
                AddServerError::Store(error) => error.into_rootcause(),
            })?;

        Ok(self.connection(url.clone(), added.record().clone()))
    }

    /// Finish signing in to a server: exchange the code the authorization
    /// server redirected back with, and store the grant. The OAuth callback
    /// route calls this.
    #[tracing::instrument(skip_all, err)]
    pub(crate) async fn complete_authorization(
        &self,
        code: &str,
        state: &str,
    ) -> Result<SourceConnection, Report> {
        let record = self
            .oauth
            .exchange_authorization_code(code, state)
            .await
            .into_rootcause()?;
        let url = ServerUrl::parse(&record.url)?;
        Ok(self.connection(url, record))
    }

    /// The user's rows with their normalized address, leaving out rows whose
    /// URL does not parse and GitHub's, which the account link owns.
    async fn rows(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<(ServerUrl, McpServerRecord)>, Report> {
        let rows = self
            .store
            .list(user)
            .await
            .map_err(|error| anyhow::Error::from(error).into_rootcause())?;

        Ok(rows
            .into_iter()
            .filter_map(|record| match ServerUrl::parse(&record.url) {
                Ok(url) => Some((url, record)),
                Err(error) => {
                    tracing::warn!(error = ?error, server = %record.server_name, "skipping an MCP server whose URL does not parse");
                    None
                }
            })
            .filter(|(url, _)| !is_github(url))
            .collect())
    }

    /// The user's row for `key`, which must be a server added by URL.
    async fn row(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<McpServerRecord, Report> {
        let ConnectorKey::Server(url) = key else {
            return Err(SourceRefusal::Unsupported(key.clone()).into());
        };

        self.rows(user)
            .await?
            .into_iter()
            .find(|(held, _)| held == url)
            .map(|(_, record)| record)
            .ok_or_else(|| SourceRefusal::NotFound(key.clone()).into())
    }

    async fn save(&self, record: &McpServerRecord) -> Result<(), Report> {
        self.store
            .save(record)
            .await
            .map_err(|error| anyhow::Error::from(error).into_rootcause())
    }

    fn connection(&self, url: ServerUrl, record: McpServerRecord) -> SourceConnection {
        let key = ConnectorKey::Server(url);
        let authorized = record
            .credentials
            .as_ref()
            .is_some_and(|credentials| credentials.token_response.is_some());
        SourceConnection {
            source: SourceKind::Native,
            key: key.clone(),
            source_id: record.url.clone(),
            name: record.server_name.clone(),
            enabled: record.enabled,
            authorized,
            mcp: Some(Arc::new(NativeMcp {
                key,
                record,
                http: self.http.clone(),
                store: self.store.clone(),
            })),
            api: None,
        }
    }
}

#[async_trait::async_trait]
impl<S, O> Source for NativeSource<S, O>
where
    S: McpServerStore,
    O: OAuthClient,
    anyhow::Error: From<S::Err>,
{
    fn kind(&self) -> SourceKind {
        SourceKind::Native
    }

    #[tracing::instrument(skip_all, err)]
    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<SourceConnection>, Report> {
        Ok(self
            .rows(user)
            .await?
            .into_iter()
            .map(|(url, record)| self.connection(url, record))
            .collect())
    }

    /// Native serves servers, not catalog apps: an overlaid app is served
    /// through its server's URL, which the resolver maps. It never provides
    /// an API (rule 6).
    async fn supports(
        &self,
        _app: &ConnectorId,
    ) -> Result<Option<crate::domain::models::Surfaces>, Report> {
        Ok(None)
    }

    /// Native never provides an API, so no background sync reads its
    /// connections.
    async fn holders(&self, _app: &ConnectorId) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(Vec::new())
    }

    /// Sign in to a server by URL through its OAuth authorization server.
    /// The row need not exist yet: completing the flow stores it.
    #[tracing::instrument(skip(self, user), err)]
    async fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep, Report> {
        let ConnectorKey::Server(url) = key else {
            return Err(SourceRefusal::Unsupported(key.clone()).into());
        };
        if is_github(url) {
            return Err(SourceRefusal::Unsupported(key.clone()).into());
        }

        let (server_url, server_name) = match self.row(user, key).await {
            Ok(record) => (record.url, record.server_name),
            Err(error) if is_not_found(&error) => (url.to_string(), default_name(url)),
            Err(error) => return Err(error),
        };
        let authorization_url = self
            .oauth
            .start_authorization(user, &server_url, &server_name)
            .await
            .into_rootcause()?;

        Ok(ConnectStep::OpenUrl(Url::parse(&authorization_url)?))
    }

    /// Native connections complete through the OAuth callback
    /// ([`NativeSource::complete_authorization`]), never by app.
    async fn complete_connect(
        &self,
        _user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<SourceConnection, Report> {
        Err(SourceRefusal::Unsupported(ConnectorKey::App(app.clone())).into())
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> Result<(), Report> {
        let mut record = self.row(user, key).await?;
        record.enabled = enabled;
        self.save(&record).await
    }

    #[tracing::instrument(skip(self, user, name), err)]
    async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> Result<(), Report> {
        let name = name.trim();
        if name.is_empty() {
            return Err(SourceRefusal::EmptyName.into());
        }
        let mut record = self.row(user, key).await?;
        record.server_name = name.to_owned();
        self.save(&record).await
    }

    /// Delete the row and the grant it holds. Removing a server the user does
    /// not hold succeeds.
    #[tracing::instrument(skip(self, user), err)]
    async fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<(), Report> {
        let record = match self.row(user, key).await {
            Ok(record) => record,
            Err(error) if is_not_found(&error) => return Ok(()),
            Err(error) => return Err(error),
        };
        self.store
            .delete(user, &record.url)
            .await
            .map_err(|error| anyhow::Error::from(error).into_rootcause())
    }
}

/// One stored server, dialed with its own grant.
struct NativeMcp<S> {
    key: ConnectorKey,
    record: McpServerRecord,
    http: McpHttp,
    store: Arc<S>,
}

#[async_trait::async_trait]
impl<S: McpServerStore> McpConnection for NativeMcp<S> {
    /// Today's in-process connect: rmcp refreshes the grant lazily and the
    /// rotated grant is written back to the row.
    async fn dial(&self) -> Result<McpServer, Report> {
        self.record
            .connect(&self.http, self.store.clone())
            .await
            .map_err(|error| {
                if matches!(
                    error.downcast_ref::<AuthError>(),
                    Some(AuthError::AuthorizationRequired)
                ) {
                    SourceRefusal::NeedsReauth(self.key.clone()).into()
                } else {
                    error.into_rootcause()
                }
            })
    }

    /// The stored bearer, refreshed and written back first if it is about to
    /// expire; no bearer for a server added without signing in.
    async fn upstream(&self) -> Result<Upstream, Report> {
        let url = Url::parse(&self.record.url)?;
        let access = server_access(&self.record, &self.http, self.store.clone()).await?;
        let bearer = match access {
            ServerAccess::Anonymous => None,
            ServerAccess::Bearer(token) => Some(token),
            ServerAccess::AuthorizationRequired => {
                return Err(SourceRefusal::NeedsReauth(self.key.clone()).into());
            }
        };
        Ok(Upstream::new(url, bearer, http::HeaderMap::new()))
    }
}

/// Whether `url` is GitHub's MCP server, whose rows belong to the account
/// link source.
pub(crate) fn is_github(url: &ServerUrl) -> bool {
    ServerUrl::parse(GITHUB_MCP_SERVER_URL).is_ok_and(|github| github == *url)
}

/// The name a server signed in to before it was added goes by: its host.
fn default_name(url: &ServerUrl) -> String {
    Url::parse(url.as_str())
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| url.to_string())
}

fn is_not_found(error: &Report) -> bool {
    matches!(
        error.downcast_current_context::<SourceRefusal>(),
        Some(SourceRefusal::NotFound(_))
    )
}
