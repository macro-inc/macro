//! The three services other crates use, and [`Connectors`], the one
//! implementation of all three. They are the only way in: no other crate can
//! read a source's store, the overlay table or the flag, or build a handle by
//! hand.

use crate::UserMcpTools;
use crate::domain::catalog::{ConnectSupport, Overlays};
use crate::domain::models::{
    AddedBy, ApiHandle, ApiRequest, ApiResponse, ConnectStep, Connector, ConnectorId, ConnectorKey,
    ConnectorsError, McpConnections, McpHandle, Permitted, Result, ServerUrl, Status, Surfaces,
    Upstream,
};
use crate::domain::ports::{
    ConnectFlag, OverlayCatalog, ServerDirectory, Source, SourceConnection, SourceKind,
    SourceRefusal,
};
use crate::domain::resolve::{self, Flag, Resolution};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_toolset::{ConnectedServer, RemoteMcpToolSet};
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// MCP access to a user's connections.
pub trait McpConnectionsService: Send + Sync + 'static {
    /// Everything this user has, already decided by the rules.
    fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<McpConnections>> + Send;

    /// Tools for in-process agents. A connection that fails to dial is left
    /// out, not an error.
    fn toolset(&self, connections: &[McpHandle]) -> impl Future<Output = UserMcpTools> + Send;

    /// The upstream call for the sandbox proxy. Takes proof the session may
    /// reach it.
    fn upstream(&self, permitted: Permitted<'_>) -> impl Future<Output = Result<Upstream>> + Send;
}

/// API access to connected apps.
pub trait ApiConnectionsService: Send + Sync + 'static {
    /// This user's API access to one app, if their connection provides it.
    fn connection(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> impl Future<Output = Result<Option<ApiHandle>>> + Send;

    /// Every user with API access to an app. Granola's background sync uses
    /// this.
    fn holders(&self, app: &ConnectorId) -> impl Future<Output = Result<Vec<ApiHandle>>> + Send;

    /// Call the app's API through a connection.
    fn call(
        &self,
        connection: &ApiHandle,
        request: ApiRequest,
    ) -> impl Future<Output = Result<ApiResponse>> + Send;
}

/// Listing, connecting and changing a user's connections.
pub trait ConnectionManagementService: Send + Sync + 'static {
    /// What the web shows: each app or URL server with its status.
    fn list(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Connector>>> + Send;

    /// Whether an app exists in the catalog at all. Agent app pins use this.
    fn connectable(&self, app: &ConnectorId) -> impl Future<Output = Result<bool>> + Send;

    /// Begin connecting an app, or signing in to a server added by URL.
    fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> impl Future<Output = Result<ConnectStep>> + Send;

    /// Record the connection the user just finished making to an app.
    fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> impl Future<Output = Result<Connector>> + Send;

    /// Add a server by URL, enabled and not yet signed in to. A URL the user
    /// already has is returned as it stands.
    fn add_server(
        &self,
        user: &MacroUserIdStr<'static>,
        url: ServerUrl,
        name: &str,
        added_by: AddedBy,
    ) -> impl Future<Output = Result<Connector>> + Send;

    /// Turn a connection on or off.
    fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Rename a connection.
    fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Remove a connection. Removing GitHub unlinks the account.
    fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// How many users [`ApiConnectionsService::holders`] resolves at once.
const HOLDER_RESOLUTIONS_IN_FLIGHT: usize = 8;

/// The connection services over every source, the flag and the overlay
/// table. Cheap to clone; built once per process by `composition`.
#[derive(Clone)]
pub struct Connectors {
    inner: Arc<Inner>,
}

struct Inner {
    /// One source of each kind, at most.
    sources: Vec<Arc<dyn Source>>,
    /// Where servers added by URL are kept; `None` without the native source.
    servers: Option<Arc<dyn ServerDirectory>>,
    flag: Box<dyn ReadFlag>,
    overlays: Box<dyn ReadOverlays>,
}

/// [`ConnectFlag`], object-safe (`#[async_trait]`) so [`Connectors`] names no
/// adapter type.
#[async_trait::async_trait]
trait ReadFlag: Send + Sync {
    async fn read(&self, user: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report>;
}

#[async_trait::async_trait]
impl<F: ConnectFlag> ReadFlag for F {
    async fn read(&self, user: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report> {
        ConnectFlag::read(self, user).await
    }
}

/// [`OverlayCatalog`], object-safe (`#[async_trait]`) so [`Connectors`] names
/// no adapter type.
#[async_trait::async_trait]
trait ReadOverlays: Send + Sync {
    async fn read(&self) -> Result<Overlays, rootcause::Report>;
}

#[async_trait::async_trait]
impl<O: OverlayCatalog> ReadOverlays for O {
    async fn read(&self) -> Result<Overlays, rootcause::Report> {
        self.overlays().await
    }
}

/// What to do when one source cannot list a user's connections.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SourceOutage {
    /// Answer without that source. Safe for tool loading: leaving a source
    /// out only removes connections, and the rules never count a connection
    /// from a source other than the one they name.
    Skip,
    /// Fail the call: a listing or API lookup must not report "not
    /// connected" because a store was down.
    Fail,
}

/// Everything the rules need for one user.
struct Snapshot {
    flag: Flag,
    overlays: Overlays,
    connect: ConnectSupport,
    connections: Vec<SourceConnection>,
}

impl Snapshot {
    fn resolve(&self, user: &MacroUserIdStr<'static>) -> Resolution {
        resolve::resolve(
            user,
            self.flag,
            &self.overlays,
            &self.connect,
            self.connections.clone(),
        )
    }
}

impl Connectors {
    /// The services over `sources` (at most one of each kind).
    pub(crate) fn new(
        sources: Vec<Arc<dyn Source>>,
        servers: Option<Arc<dyn ServerDirectory>>,
        flag: impl ConnectFlag,
        overlays: impl OverlayCatalog,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                sources,
                servers,
                flag: Box::new(flag),
                overlays: Box::new(overlays),
            }),
        }
    }

    fn source(&self, kind: SourceKind) -> Option<&Arc<dyn Source>> {
        self.inner
            .sources
            .iter()
            .find(|source| source.kind() == kind)
    }

    /// The flag, the overlay table, every source's connections, and what
    /// Connect serves among the apps they are to.
    async fn snapshot(
        &self,
        user: &MacroUserIdStr<'static>,
        outage: SourceOutage,
    ) -> Result<Snapshot> {
        let (flag, overlays, connections) = futures::join!(
            self.inner.flag.read(user),
            self.inner.overlays.read(),
            self.held(user, outage),
        );
        let flag = Flag::from_read(flag);
        let overlays = overlays?;
        let connections = connections?;
        let connect = self.connect_support(flag, &overlays, &connections).await?;

        Ok(Snapshot {
            flag,
            overlays,
            connect,
            connections,
        })
    }

    /// Every connection the user holds in every source.
    async fn held(
        &self,
        user: &MacroUserIdStr<'static>,
        outage: SourceOutage,
    ) -> Result<Vec<SourceConnection>> {
        let listings = futures::future::join_all(
            self.inner
                .sources
                .iter()
                .map(|source| async move { (source.kind(), source.connections(user).await) }),
        )
        .await;

        let mut connections = Vec::new();
        for (kind, listing) in listings {
            match (listing, outage) {
                (Ok(held), _) => connections.extend(held),
                (Err(error), SourceOutage::Skip) => {
                    tracing::warn!(source = ?kind, error = ?error, "could not list a source's connections; answering without it");
                }
                (Err(error), SourceOutage::Fail) => return Err(error.into()),
            }
        }

        Ok(connections)
    }

    /// What Connect serves among the apps `connections` are to. Only asked
    /// with the flag on: off, no Connect connection counts.
    async fn connect_support(
        &self,
        flag: Flag,
        overlays: &Overlays,
        connections: &[SourceConnection],
    ) -> Result<ConnectSupport> {
        let (Flag::On, Some(connect)) = (flag, self.source(SourceKind::Connect)) else {
            return Ok(ConnectSupport::default());
        };

        let apps: HashSet<ConnectorId> = connections
            .iter()
            .flat_map(|connection| resolve::identify(connection, overlays))
            .filter_map(|key| match key {
                ConnectorKey::App(app) => Some(app),
                ConnectorKey::Server(_) => None,
            })
            .collect();
        let answers = futures::future::join_all(apps.into_iter().map(|app| async move {
            let surfaces = connect.supports(&app).await?;
            Ok::<_, rootcause::Report>(surfaces.map(|surfaces| (app, surfaces)))
        }))
        .await;

        let mut supported = Vec::new();
        for answer in answers {
            supported.extend(answer?);
        }

        Ok(ConnectSupport::new(supported))
    }

    /// The source whose connection counts for `app` for this user, and the
    /// key that source knows it by: an overlaid app's server for the native
    /// source, the app for every other.
    async fn designated(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<(&Arc<dyn Source>, ConnectorKey)> {
        let (flag, overlays) =
            futures::join!(self.inner.flag.read(user), self.inner.overlays.read());
        let flag = Flag::from_read(flag);
        let overlays = overlays?;

        let mut connect = ConnectSupport::default();
        if let (Flag::On, Some(source)) = (flag, self.source(SourceKind::Connect))
            && let Some(surfaces) = source.supports(app).await?
        {
            connect = ConnectSupport::new([(app.clone(), surfaces)]);
        }

        let kind = resolve::counted_source(app, flag, &overlays, &connect);
        let source = self
            .source(kind)
            .ok_or_else(|| ConnectorsError::UnknownApp(app.clone()))?;
        let key = match (kind, overlays.server_of(app)) {
            (SourceKind::Native, Some(server)) => ConnectorKey::Server(server.clone()),
            _ => ConnectorKey::App(app.clone()),
        };

        Ok((source, key))
    }

    /// Every connection the user holds that is to `key`, each with the
    /// source holding it. A native row at an overlay server is to every app
    /// overlaid there.
    async fn holding(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<Vec<(&Arc<dyn Source>, ConnectorKey)>> {
        let (overlays, connections) = futures::join!(
            self.inner.overlays.read(),
            self.held(user, SourceOutage::Fail)
        );
        let overlays = overlays?;

        let mut holding: Vec<(&Arc<dyn Source>, ConnectorKey)> = Vec::new();
        for connection in connections? {
            if !resolve::identify(&connection, &overlays).contains(key) {
                continue;
            }
            let Some(source) = self.source(connection.source) else {
                continue;
            };
            let already = holding.iter().any(|(held_by, held)| {
                held_by.kind() == connection.source && *held == connection.key
            });
            if !already {
                holding.push((source, connection.key));
            }
        }

        if holding.is_empty() {
            return Err(ConnectorsError::NotFound(key.clone()));
        }

        Ok(holding)
    }

    /// The user's listing, as [`ConnectionManagementService::list`] answers.
    fn listing(user: &MacroUserIdStr<'static>, snapshot: &Snapshot) -> Vec<Connector> {
        let resolution = snapshot.resolve(user);
        let mut listed: BTreeMap<ConnectorKey, Connector> = BTreeMap::new();
        for resolved in resolution.mcp.resolved() {
            listed.insert(
                resolved.key.clone(),
                Connector::new(
                    resolved.key.clone(),
                    resolved.name.clone(),
                    resolved.status,
                    true,
                    resolved.surfaces,
                ),
            );
        }

        // A connection the rules ignore still shows, as not connected, so the
        // user sees why and can connect the app the way that counts. It
        // reports what the counted source would provide.
        for connection in &snapshot.connections {
            for key in resolve::identify(connection, &snapshot.overlays) {
                let ConnectorKey::App(app) = &key else {
                    continue;
                };
                if listed.contains_key(&key) {
                    continue;
                }

                let counted = resolve::counted_source(
                    app,
                    snapshot.flag,
                    &snapshot.overlays,
                    &snapshot.connect,
                );
                let surfaces = match counted {
                    SourceKind::Connect => snapshot.connect.surfaces(app).unwrap_or_default(),
                    SourceKind::Pipedream => Surfaces::new(true, true),
                    SourceKind::Native | SourceKind::GithubLink => Surfaces::new(true, false),
                };
                listed.insert(
                    key.clone(),
                    Connector::new(
                        key,
                        connection.name.clone(),
                        Status::NotConnected,
                        true,
                        surfaces,
                    ),
                );
            }
        }

        listed.into_values().collect()
    }
}

/// A source's refusal as the service error it means; anything else is
/// internal.
fn refusal_error(report: rootcause::Report) -> ConnectorsError {
    let Some(refusal) = report.downcast_current_context::<SourceRefusal>() else {
        return ConnectorsError::Internal(report);
    };

    match refusal.clone() {
        SourceRefusal::NotFound(key)
        | SourceRefusal::Unsupported(key @ ConnectorKey::Server(_)) => {
            ConnectorsError::NotFound(key)
        }
        SourceRefusal::NeedsReauth(key) => ConnectorsError::NeedsReauth(key),
        SourceRefusal::Unsupported(ConnectorKey::App(app)) => ConnectorsError::UnknownApp(app),
        SourceRefusal::NonPublic(url) => ConnectorsError::NonPublicServer(url),
        SourceRefusal::EmptyName => ConnectorsError::EmptyName,
    }
}

impl McpConnectionsService for Connectors {
    #[tracing::instrument(name = "connectors.mcp_connections", skip_all, err, fields(connections = tracing::field::Empty))]
    async fn connections(&self, user: &MacroUserIdStr<'static>) -> Result<McpConnections> {
        let snapshot = self.snapshot(user, SourceOutage::Skip).await?;
        let connections = snapshot.resolve(user).mcp;
        tracing::Span::current().record("connections", connections.handles().count());

        Ok(connections)
    }

    #[tracing::instrument(name = "connectors.toolset", skip_all, fields(servers = connections.len(), dialed = tracing::field::Empty))]
    async fn toolset(&self, connections: &[McpHandle]) -> UserMcpTools {
        let dials = connections.iter().map(|handle| async move {
            handle
                .connection()
                .dial()
                .await
                .inspect_err(|error| {
                    tracing::warn!(connector = %handle.key(), error = ?error, "could not dial a connection; leaving its tools out");
                })
                .ok()
                .map(|client| ConnectedServer {
                    name: handle.name().to_owned(),
                    client,
                })
        });
        let servers: Vec<ConnectedServer> = futures::future::join_all(dials)
            .await
            .into_iter()
            .flatten()
            .collect();
        tracing::Span::current().record("dialed", servers.len());

        UserMcpTools::connected(RemoteMcpToolSet::from_connected(servers, None).await)
    }

    #[tracing::instrument(name = "connectors.upstream", skip_all, err, fields(connector = %permitted.key()))]
    async fn upstream(&self, permitted: Permitted<'_>) -> Result<Upstream> {
        permitted
            .handle()
            .connection()
            .upstream()
            .await
            .map_err(refusal_error)
    }
}

impl ApiConnectionsService for Connectors {
    #[tracing::instrument(name = "connectors.api_connection", skip(self, user), err)]
    async fn connection(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Option<ApiHandle>> {
        let snapshot = self.snapshot(user, SourceOutage::Fail).await?;
        let handle = snapshot
            .resolve(user)
            .api
            .into_iter()
            .find(|handle| handle.app() == app);

        Ok(handle)
    }

    #[tracing::instrument(name = "connectors.api_holders", skip(self), err, fields(holders = tracing::field::Empty, skipped = tracing::field::Empty))]
    async fn holders(&self, app: &ConnectorId) -> Result<Vec<ApiHandle>> {
        // Every source's holders are only candidates: each user's own
        // resolution decides whether their counted connection gives API.
        let listings =
            futures::future::join_all(self.inner.sources.iter().map(|source| source.holders(app)))
                .await;
        let mut seen = HashSet::new();
        let mut users = Vec::new();
        for listing in listings {
            for user in listing? {
                if seen.insert(user.clone()) {
                    users.push(user);
                }
            }
        }

        // A few users at a time; one user's failure skips that user, never
        // the rest.
        let mut holders = Vec::new();
        let mut skipped = 0_usize;
        for batch in users.chunks(HOLDER_RESOLUTIONS_IN_FLIGHT) {
            let answers =
                futures::future::join_all(batch.iter().map(|user| self.connection(user, app)))
                    .await;
            for answer in answers {
                match answer {
                    Ok(handle) => holders.extend(handle),
                    Err(error) => {
                        skipped += 1;
                        tracing::warn!(error = ?error, "could not resolve a holder's connection; skipping them");
                    }
                }
            }
        }
        let span = tracing::Span::current();
        span.record("holders", holders.len());
        span.record("skipped", skipped);

        Ok(holders)
    }

    #[tracing::instrument(name = "connectors.api_call", skip_all, err, fields(app = %connection.app()))]
    async fn call(&self, connection: &ApiHandle, request: ApiRequest) -> Result<ApiResponse> {
        connection
            .connection()
            .call(request)
            .await
            .map_err(refusal_error)
    }
}

impl ConnectionManagementService for Connectors {
    #[tracing::instrument(name = "connectors.list", skip_all, err, fields(connectors = tracing::field::Empty))]
    async fn list(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<Connector>> {
        let snapshot = self.snapshot(user, SourceOutage::Fail).await?;
        let listing = Self::listing(user, &snapshot);
        tracing::Span::current().record("connectors", listing.len());

        Ok(listing)
    }

    #[tracing::instrument(name = "connectors.connectable", skip(self), err)]
    async fn connectable(&self, app: &ConnectorId) -> Result<bool> {
        // An overlaid app is Macro's own part of the catalog: it connects to
        // its vendor's server, whether or not a hosted source lists it.
        if self.inner.overlays.read().await?.is_overlaid(app) {
            return Ok(true);
        }
        let answers =
            futures::future::join_all(self.inner.sources.iter().map(|source| source.supports(app)))
                .await;

        // One source serving it is enough, even while another is down.
        let mut failure = None;
        for answer in answers {
            match answer {
                Ok(Some(_)) => return Ok(true),
                Ok(None) => {}
                Err(error) => failure = Some(error),
            }
        }

        match failure {
            Some(error) => Err(error.into()),
            None => Ok(false),
        }
    }

    #[tracing::instrument(name = "connectors.start_connect", skip(self, user), err)]
    async fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep> {
        let (source, key) = match key {
            ConnectorKey::Server(_) => {
                let native = self
                    .source(SourceKind::Native)
                    .ok_or_else(|| ConnectorsError::NotFound(key.clone()))?;
                (native, key.clone())
            }
            ConnectorKey::App(app) => {
                let (source, source_key) = self.designated(user, app).await?;
                // Pipedream's directory is its own: an app it does not list
                // cannot be connected through it.
                if source.kind() == SourceKind::Pipedream && source.supports(app).await?.is_none() {
                    return Err(ConnectorsError::UnknownApp(app.clone()));
                }
                (source, source_key)
            }
        };

        source
            .start_connect(user, &key)
            .await
            .map_err(refusal_error)
    }

    #[tracing::instrument(name = "connectors.complete_connect", skip(self, user), err)]
    async fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Connector> {
        let (source, _) = self.designated(user, app).await?;
        // A native server finishes signing in on its OAuth callback, which
        // stores the grant itself; there is nothing left to record here.
        if source.kind() != SourceKind::Native {
            source
                .complete_connect(user, app)
                .await
                .map_err(refusal_error)?;
        }

        // Another source being down cannot change whether this connection
        // counts, so the answer does not wait on it.
        let key = ConnectorKey::App(app.clone());
        let snapshot = self.snapshot(user, SourceOutage::Skip).await?;
        Self::listing(user, &snapshot)
            .into_iter()
            .find(|connector| *connector.key() == key)
            .ok_or(ConnectorsError::NotFound(key))
    }

    #[tracing::instrument(name = "connectors.add_server", skip(self, user, name), err)]
    async fn add_server(
        &self,
        user: &MacroUserIdStr<'static>,
        url: ServerUrl,
        name: &str,
        added_by: AddedBy,
    ) -> Result<Connector> {
        if name.trim().is_empty() {
            return Err(ConnectorsError::EmptyName);
        }
        let servers = self
            .inner
            .servers
            .as_ref()
            .ok_or_else(|| ConnectorsError::NotFound(ConnectorKey::Server(url.clone())))?;
        let added = servers
            .add_server(user, &url, name, added_by)
            .await
            .map_err(refusal_error)?;

        // A server at an overlay's address is that app, not a server added
        // by URL (rule 5). Another source being down cannot change how the
        // new row counts, so the answer does not wait on it.
        let snapshot = self.snapshot(user, SourceOutage::Skip).await?;
        let keys = resolve::identify(&added, &snapshot.overlays);
        Self::listing(user, &snapshot)
            .into_iter()
            .find(|connector| keys.contains(connector.key()))
            .ok_or(ConnectorsError::NotFound(ConnectorKey::Server(url)))
    }

    #[tracing::instrument(name = "connectors.set_enabled", skip(self, user), err)]
    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> Result<()> {
        for (source, source_key) in self.holding(user, key).await? {
            source
                .set_enabled(user, &source_key, enabled)
                .await
                .map_err(refusal_error)?;
        }

        Ok(())
    }

    #[tracing::instrument(name = "connectors.rename", skip(self, user, name), err)]
    async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> Result<()> {
        if name.trim().is_empty() {
            return Err(ConnectorsError::EmptyName);
        }
        for (source, source_key) in self.holding(user, key).await? {
            source
                .rename(user, &source_key, name)
                .await
                .map_err(refusal_error)?;
        }

        Ok(())
    }

    #[tracing::instrument(name = "connectors.remove", skip(self, user), err)]
    async fn remove(&self, user: &MacroUserIdStr<'static>, key: &ConnectorKey) -> Result<()> {
        for (source, source_key) in self.holding(user, key).await? {
            source
                .remove(user, &source_key)
                .await
                .map_err(refusal_error)?;
        }

        Ok(())
    }
}
