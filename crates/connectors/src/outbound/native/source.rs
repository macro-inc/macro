//! The native source: MCP servers a user connects to directly by URL, held
//! in `mcp_servers` and dialed with Macro's own OAuth client.
//!
//! Every row reports the server's address, never an app: whether a URL is an
//! overlaid app's server is the resolver's call (rule 5). GitHub's server is
//! left out, because the account link source owns GitHub, and a row at its
//! address only stores that link's enabled toggle and name.

use crate::domain::models::{AddedBy, ConnectStep, ConnectorId, ConnectorKey, ServerUrl, Upstream};
use crate::domain::ports::{
    GrantState, McpConnection, Source, SourceConnection, SourceKind, SourceRefusal,
};
use crate::outbound::guarded_http::McpHttp;
use crate::outbound::native::models::StoredCredentials;
use crate::outbound::native::models::{
    GITHUB_MCP_SERVER_URL, MacroUserIdStr, McpServer, McpServerRecord,
};
use crate::outbound::native::ports::{McpConnector, McpServerHttp, McpServerStore, OAuthClient};
use crate::outbound::native::server_access::{
    ServerAccess, now_epoch_secs, server_access, unexpired_access_token,
};
use crate::outbound::native::server_directory::{
    self as native_service, AddServerError, ServerDirectory,
};
use oauth2::TokenResponse as _;
use rmcp::service::ClientInitializeError;
use rmcp::transport::DynamicTransportError;
use rmcp::transport::auth::AuthError;
use rmcp::transport::streamable_http_client::StreamableHttpError;
use rootcause::Report;
use rootcause::compat::IntoRootcause as _;
use std::sync::Arc;
use std::time::Duration;
use url::Url;

/// How long adding a server waits for its answer to a request without a
/// token, before taking it as a server that needs none.
const SIGN_IN_PROBE_TIMEOUT: Duration = Duration::from_secs(5);

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
    /// returned as stored: saving over it would wipe its grant.
    ///
    /// A server without a grant or a mark, new or held, is asked once,
    /// without a token, whether it takes requests like that: one that
    /// answers HTTP 401 is stored as needing a sign-in, so it reads as such
    /// instead of connected. Adding a held URL again retries an answer an
    /// earlier add failed to store.
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
            // Asked again: an earlier add may have failed to store its
            // answer, and adding again is how a caller retries that.
            let record = self.classify(user, record).await?;
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

        let record = self.classify(user, added.record().clone()).await?;
        Ok(self.connection(url.clone(), record))
    }

    /// `record` with whether it needs a sign-in found out, when it holds no
    /// grant and isn't marked yet: the server is asked once without a token,
    /// and a 401 is stored. A grant stored meanwhile keeps the row unmarked,
    /// since the store's mark is conditional on there being none.
    async fn classify(
        &self,
        user: &MacroUserIdStr<'static>,
        mut record: McpServerRecord,
    ) -> Result<McpServerRecord, Report> {
        if record.credentials.is_none()
            && !record.requires_sign_in
            && needs_sign_in(&self.http, &record.url).await
        {
            self.store
                .mark_requires_sign_in(user, &record.url)
                .await
                .map_err(|error| anyhow::Error::from(error).into_rootcause())?;
            record.requires_sign_in = true;
        }
        Ok(record)
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
        let grant = grant(
            record.credentials.as_ref(),
            record.requires_sign_in,
            now_epoch_secs(),
        );
        SourceConnection {
            source: SourceKind::Native,
            key: key.clone(),
            source_id: record.url.clone(),
            name: record.server_name.clone(),
            enabled: record.enabled,
            grant,
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

/// Object-safe (`#[async_trait]`): the service holds it as a trait object.
#[async_trait::async_trait]
impl<S, O> crate::domain::ports::ServerDirectory for NativeSource<S, O>
where
    S: McpServerStore,
    O: OAuthClient,
    anyhow::Error: From<S::Err>,
{
    async fn add_server(
        &self,
        user: &MacroUserIdStr<'static>,
        url: &ServerUrl,
        name: &str,
        added_by: AddedBy,
    ) -> Result<SourceConnection, Report> {
        NativeSource::add_server(self, user, url, name, added_by).await
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

    /// Native connections complete through the OAuth callback (the server
    /// sign-ins in `domain::sign_in`), never by app.
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

impl<S> NativeMcp<S>
where
    S: McpServerStore,
    anyhow::Error: From<S::Err>,
{
    /// Whether the row is a server that needs a sign-in it never got.
    fn awaits_sign_in(&self) -> bool {
        self.record.credentials.is_none() && self.record.requires_sign_in
    }
}

#[async_trait::async_trait]
impl<S> McpConnection for NativeMcp<S>
where
    S: McpServerStore,
    anyhow::Error: From<S::Err>,
{
    /// Today's in-process connect: rmcp refreshes the grant lazily and the
    /// rotated grant is written back to the row. A server that answers 401
    /// needs reauth, and one called without a token is stored as needing a
    /// sign-in.
    async fn dial(&self) -> Result<McpServer, Report> {
        if self.awaits_sign_in() {
            return Err(SourceRefusal::NeedsReauth(self.key.clone()).into());
        }
        let error = match self.record.connect(&self.http, self.store.clone()).await {
            Ok(server) => return Ok(server),
            Err(error) => error,
        };
        if answered_unauthorized(&error) {
            if let Err(error) = self.unauthorized().await {
                tracing::warn!(error = ?error, server = %self.record.server_name, "could not record that a server needs a sign-in");
            }
            return Err(SourceRefusal::NeedsReauth(self.key.clone()).into());
        }
        if matches!(
            error.downcast_ref::<AuthError>(),
            Some(AuthError::AuthorizationRequired)
        ) {
            return Err(SourceRefusal::NeedsReauth(self.key.clone()).into());
        }
        Err(error.into_rootcause())
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

    /// A 401 to a request without a token means the server needs a sign-in:
    /// stored on the row. A row holding a grant is left alone; its grant is
    /// judged when it is refreshed.
    async fn unauthorized(&self) -> Result<(), Report> {
        if self.record.credentials.is_some() {
            return Ok(());
        }
        self.store
            .mark_requires_sign_in(&self.record.user_id, &self.record.url)
            .await
            .map_err(|error| anyhow::Error::from(error).into_rootcause())
    }
}

/// What a row's stored credentials hold, from what the row itself shows:
/// no network call, so a refresh token the server has since revoked still
/// reads as working until a dial or the proxy finds out. Dead is what the
/// proxy would answer "authorization required" for without asking the
/// server: a sign-in that never finished, or an expired token with no
/// refresh token. A server that answered 401 without a token and was never
/// signed in to is dead too: the proxy refuses it the same way.
pub(crate) fn grant(
    credentials: Option<&StoredCredentials>,
    requires_sign_in: bool,
    now_epoch_secs: u64,
) -> GrantState {
    let Some(credentials) = credentials else {
        return if requires_sign_in {
            GrantState::Dead
        } else {
            GrantState::Missing
        };
    };
    let Some(token) = &credentials.token_response else {
        return GrantState::Dead;
    };
    if unexpired_access_token(credentials, now_epoch_secs).is_none()
        && token.refresh_token().is_none()
    {
        return GrantState::Dead;
    }

    GrantState::Working
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

/// Whether the server at `url` answers an MCP `initialize` sent without a
/// token with HTTP 401, the MCP authorization spec's way of saying it needs
/// a sign-in. Any other answer, or none within [`SIGN_IN_PROBE_TIMEOUT`],
/// proves nothing, and the server is taken as one that needs no sign-in.
/// A server that does answer may keep the session it opened until it
/// expires it.
async fn needs_sign_in(http: &McpHttp, url: &str) -> bool {
    let Ok(url) = Url::parse(url) else {
        return false;
    };
    if http.check_url(&url).is_err() {
        return false;
    }
    let initialize = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": mcp_toolset::client_info(),
    });
    let answer = http
        .transport()
        .post(url)
        .timeout(SIGN_IN_PROBE_TIMEOUT)
        .header(http::header::ACCEPT, "application/json, text/event-stream")
        .json(&initialize)
        .send()
        .await;
    match answer {
        Ok(response) => response.status() == http::StatusCode::UNAUTHORIZED,
        Err(error) => {
            tracing::info!(error = %error, "a new server did not answer the sign-in probe; taking it as needing none");
            false
        }
    }
}

/// Whether a failed dial failed because the server answered HTTP 401, as
/// the MCP authorization spec has a server that needs a sign-in do. rmcp
/// 3.9 says `AuthRequired` for a 401 with a `WWW-Authenticate` challenge,
/// and `UnexpectedServerResponse("HTTP 401 ...")` for one without; the
/// add-time probe and the proxy count both, so a dial does too.
fn answered_unauthorized(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        let transport = match cause.downcast_ref::<ClientInitializeError>() {
            Some(ClientInitializeError::TransportError { error, .. }) => Some(error),
            _ => cause.downcast_ref::<DynamicTransportError>(),
        };
        let http = match transport {
            Some(transport) => transport
                .error
                .downcast_ref::<StreamableHttpError<reqwest::Error>>(),
            None => cause.downcast_ref::<StreamableHttpError<reqwest::Error>>(),
        };
        match http {
            Some(StreamableHttpError::AuthRequired(_)) => true,
            Some(StreamableHttpError::UnexpectedServerResponse(message)) => {
                message.starts_with("HTTP 401 ")
            }
            _ => false,
        }
    })
}
