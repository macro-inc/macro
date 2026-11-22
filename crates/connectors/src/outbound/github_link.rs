//! The GitHub account link as a source: a user who linked GitHub to their
//! Macro account has GitHub connected, through GitHub's own MCP server.
//!
//! The account link and GitHub's MCP server use the same GitHub App, so the
//! link's token is a valid bearer there and the user never authorizes GitHub
//! twice. The token lives with the link in the authentication service and is
//! never stored here. A link whose token GitHub no longer accepts is held but
//! not authorized: the resolver reports it as needing reauthorization
//! (rule 8). Removing the connection unlinks the account.
//!
//! The enabled toggle and display name stay where they always were: a row in
//! `mcp_servers` at GitHub's address, whose credentials are never read. The
//! native source leaves that row out.

use crate::domain::models::{
    ConnectStep, ConnectorId, ConnectorKey, ServerUrl, Surfaces, Upstream,
};
use crate::domain::ports::{
    GrantState, McpConnection, Source, SourceConnection, SourceKind, SourceRefusal,
};
use crate::outbound::guarded_http::McpHttp;
use crate::outbound::native::models::{
    GITHUB_MCP_SERVER_URL, MacroUserIdStr, McpServer, McpServerRecord, dial_with_bearer,
};
use crate::outbound::native::ports::McpServerStore;
use crate::outbound::native::source::is_github;
use rootcause::Report;
use rootcause::compat::IntoRootcause as _;
use std::sync::Arc;
use url::Url;

pub(crate) mod auth_service;

#[cfg(test)]
mod test;

/// The name GitHub goes by until the user renames it.
const GITHUB_NAME: &str = "GitHub";

/// The web page that starts linking GitHub to the user's Macro account,
/// under the app's origin. Connecting GitHub through this source opens it,
/// so the web opens what the server answers for every app, GitHub included.
const LINK_PAGE_PATH: &str = "/app/connect/github";

/// Where a user's GitHub account link stands.
#[derive(Clone, PartialEq, Eq)]
pub(crate) enum LinkToken {
    /// Linked, with a token GitHub still accepts.
    Working(String),
    /// Linked, but GitHub no longer accepts the token.
    NeedsReauth,
    /// Never linked, or unlinked since.
    NotLinked,
}

impl std::fmt::Debug for LinkToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Working(_) => formatter.write_str("Working([REDACTED])"),
            Self::NeedsReauth => formatter.write_str("NeedsReauth"),
            Self::NotLinked => formatter.write_str("NotLinked"),
        }
    }
}

/// The account link, owned by the authentication service.
///
/// Object-safe (`async_trait`) so the source holds it as `Arc<dyn _>` and
/// tests swap in a fake.
#[async_trait::async_trait]
pub(crate) trait GithubAccountLink: Send + Sync {
    /// Where the user's link stands, with its token when it works.
    async fn token(&self, user: &MacroUserIdStr<'static>) -> Result<LinkToken, Report>;

    /// Unlink the user's GitHub account. Succeeds when there is no link.
    async fn unlink(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report>;
}

/// GitHub, connected by the account link.
pub(crate) struct GithubLinkSource<S> {
    link: Arc<dyn GithubAccountLink>,
    toggles: Arc<S>,
    http: McpHttp,
    server: Url,
    link_page: Url,
}

impl<S> GithubLinkSource<S>
where
    S: McpServerStore,
    anyhow::Error: From<S::Err>,
{
    /// A source over `link`, keeping each user's toggle in the `mcp_servers`
    /// rows of `toggles`, dialing GitHub's MCP server through `http`. A user
    /// connects on the app's GitHub link page, at `app_origin`.
    pub(crate) fn new(
        link: Arc<dyn GithubAccountLink>,
        toggles: Arc<S>,
        http: McpHttp,
        app_origin: &Url,
    ) -> Result<Self, Report> {
        Ok(Self {
            link,
            toggles,
            http,
            server: Url::parse(GITHUB_MCP_SERVER_URL)?,
            link_page: app_origin.join(LINK_PAGE_PATH)?,
        })
    }

    /// Dial `server` instead of GitHub's, for tests.
    #[cfg(test)]
    fn with_server(mut self, server: Url) -> Self {
        self.server = server;
        self
    }

    /// The user's toggle row at GitHub's address, in whichever spelling it
    /// was stored.
    async fn toggle(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Option<McpServerRecord>, Report> {
        let rows = self
            .toggles
            .list(user)
            .await
            .map_err(|error| anyhow::Error::from(error).into_rootcause())?;
        Ok(rows
            .into_iter()
            .find(|record| ServerUrl::parse(&record.url).is_ok_and(|url| is_github(&url))))
    }

    /// The user's link as a connection, or `None` when they never linked.
    async fn connection(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Option<SourceConnection>, Report> {
        let token = match self.link.token(user).await? {
            LinkToken::NotLinked => return Ok(None),
            LinkToken::NeedsReauth => None,
            LinkToken::Working(token) => Some(token),
        };
        let toggle = self.toggle(user).await?;
        let key = ConnectorKey::App(ConnectorId::github());

        Ok(Some(SourceConnection {
            source: SourceKind::GithubLink,
            key: key.clone(),
            source_id: ConnectorId::github().to_string(),
            name: toggle
                .as_ref()
                .map_or_else(|| GITHUB_NAME.to_owned(), |row| row.server_name.clone()),
            enabled: toggle.as_ref().is_none_or(|row| row.enabled),
            grant: if token.is_some() {
                GrantState::Working
            } else {
                GrantState::Dead
            },
            mcp: Some(Arc::new(GithubMcp {
                key,
                server: self.server.clone(),
                token,
                http: self.http.clone(),
            })),
            api: None,
        }))
    }

    /// Refuse any key but GitHub.
    fn github_key(key: &ConnectorKey) -> Result<(), Report> {
        match key {
            ConnectorKey::App(app) if *app == ConnectorId::github() => Ok(()),
            _ => Err(SourceRefusal::Unsupported(key.clone()).into()),
        }
    }

    /// Change the toggle row of a user who holds the link.
    async fn update_toggle(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        update: impl FnOnce(&mut McpServerRecord),
    ) -> Result<(), Report> {
        Self::github_key(key)?;
        if self.link.token(user).await? == LinkToken::NotLinked {
            return Err(SourceRefusal::NotFound(key.clone()).into());
        }

        let mut row = self.toggle(user).await?.unwrap_or_else(|| McpServerRecord {
            user_id: user.clone(),
            url: GITHUB_MCP_SERVER_URL.to_owned(),
            server_name: GITHUB_NAME.to_owned(),
            credentials: None,
            enabled: true,
            requires_sign_in: false,
        });
        update(&mut row);
        // The token lives with the link; the row never holds one.
        row.credentials = None;
        self.toggles
            .save(&row)
            .await
            .map_err(|error| anyhow::Error::from(error).into_rootcause())
    }
}

#[async_trait::async_trait]
impl<S> Source for GithubLinkSource<S>
where
    S: McpServerStore,
    anyhow::Error: From<S::Err>,
{
    fn kind(&self) -> SourceKind {
        SourceKind::GithubLink
    }

    #[tracing::instrument(skip_all, err)]
    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<SourceConnection>, Report> {
        Ok(self.connection(user).await?.into_iter().collect())
    }

    /// GitHub only, and only as MCP: the link never provides an API (rule 6).
    async fn supports(&self, app: &ConnectorId) -> Result<Option<Surfaces>, Report> {
        Ok((*app == ConnectorId::github()).then_some(Surfaces::new(true, false)))
    }

    /// The link never provides an API, so no background sync reads it.
    async fn holders(&self, _app: &ConnectorId) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(Vec::new())
    }

    /// The answer is the app's own link page, never GitHub's consent URL:
    /// that URL signs whoever finishes it in to the account, so it is only
    /// minted by the page, in the signed-in user's browser.
    async fn start_connect(
        &self,
        _user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep, Report> {
        Self::github_key(key)?;
        Ok(ConnectStep::OpenUrl(self.link_page.clone()))
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<SourceConnection, Report> {
        let key = ConnectorKey::App(app.clone());
        Self::github_key(&key)?;
        self.connection(user)
            .await?
            .ok_or_else(|| SourceRefusal::NotFound(key).into())
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> Result<(), Report> {
        self.update_toggle(user, key, |row| row.enabled = enabled)
            .await
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
        self.update_toggle(user, key, |row| row.server_name = name.to_owned())
            .await
    }

    /// Unlink the account, then forget the toggle so a later link starts
    /// enabled under GitHub's own name.
    #[tracing::instrument(skip(self, user), err)]
    async fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<(), Report> {
        Self::github_key(key)?;
        self.link.unlink(user).await?;
        if let Some(row) = self.toggle(user).await? {
            self.toggles
                .delete(user, &row.url)
                .await
                .map_err(|error| anyhow::Error::from(error).into_rootcause())?;
        }
        Ok(())
    }
}

/// GitHub's MCP server with the link's token.
struct GithubMcp {
    key: ConnectorKey,
    server: Url,
    /// `None` when GitHub no longer accepts the link's token.
    token: Option<String>,
    http: McpHttp,
}

impl GithubMcp {
    fn token(&self) -> Result<&str, Report> {
        self.token
            .as_deref()
            .ok_or_else(|| SourceRefusal::NeedsReauth(self.key.clone()).into())
    }
}

#[async_trait::async_trait]
impl McpConnection for GithubMcp {
    async fn dial(&self) -> Result<McpServer, Report> {
        let token = self.token()?;
        dial_with_bearer(&self.http, &self.server, token)
            .await
            .into_rootcause()
    }

    async fn upstream(&self) -> Result<Upstream, Report> {
        let token = self.token()?;
        Ok(Upstream::new(
            self.server.clone(),
            Some(token.to_owned()),
            http::HeaderMap::new(),
        ))
    }
}
