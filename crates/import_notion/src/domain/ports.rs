//! What the importer needs from Notion, and how a user's Notion is reached.

use std::future::Future;
use std::time::Duration;

use macro_user_id::user_id::MacroUserIdStr;

use super::model::{
    NotionDataSource, NotionId, NotionPage, NotionUser, PageMarkdown, Paged, RowsPage, SearchHit,
    SearchObject,
};

use super::views::{NotionView, ViewScope};

/// Why a Notion request failed.
///
/// `Display` and `Debug` name the failure's kind, status and transport class
/// only. Notion's message, a decode error and a transport report can quote
/// workspace content, object ids or URLs, so they never reach logs or spans.
#[derive(thiserror::Error)]
pub enum NotionError {
    /// Notion (or the proxy) asked us to slow down and retries ran out.
    #[error("Notion rate limited the import; retry after {retry_after:?}")]
    RateLimited {
        /// How long Notion asked to wait, when it said.
        retry_after: Option<Duration>,
    },
    /// The object does not exist or was not shared with the connection.
    #[error("Notion object not found or not shared with the connection")]
    NotFound,
    /// Notion refused the connection's token (`401 unauthorized`): it was
    /// revoked or expired.
    #[error(
        "Notion no longer accepts Macro's connection (it was revoked or expired); reconnect Notion"
    )]
    AccessLost,
    /// The request never reached Notion: the connection's proxy answered 404
    /// without Notion's error shape, so it could not use the account.
    #[error("Macro couldn't use your Notion connection; reconnect Notion")]
    ConnectionUnavailable,
    /// The connection may not read this.
    #[error("the Notion connection may not read this object")]
    Forbidden,
    /// Notion answered with an error the importer does not handle.
    #[error("Notion could not complete the request (HTTP {status})")]
    Upstream {
        /// The HTTP status.
        status: u16,
        /// Notion's explanation, truncated. Never logged.
        body: String,
    },
    /// Notion answered with a shape the importer could not read.
    #[error("unexpected Notion response")]
    Decode(
        /// What could not be read. Never logged.
        String,
    ),
    /// One source's saved view list did not finish; retry before approximating it.
    #[error("the source saved-view list is incomplete")]
    IncompleteViewList,
    /// The request did not complete.
    #[error("Notion request did not complete ({class})")]
    Transport {
        /// What went wrong on the way, as far as the connection can tell.
        class: TransportClass,
        /// The underlying report. Never logged: it can carry the proxy URL.
        report: rootcause::Report,
    },
}

impl std::fmt::Debug for NotionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut debug = formatter.debug_struct("NotionError");
        debug.field("class", &self.class());
        if let Some(status) = self.status() {
            debug.field("status", &status);
        }
        if let Some(class) = self.transport_class() {
            debug.field("transport_class", &class);
        }
        debug.finish()
    }
}

impl NotionError {
    /// The failure's kind, for spans and logs.
    pub fn class(&self) -> NotionErrorClass {
        match self {
            Self::RateLimited { .. } => NotionErrorClass::RateLimited,
            Self::NotFound => NotionErrorClass::NotFound,
            Self::AccessLost => NotionErrorClass::AccessLost,
            Self::ConnectionUnavailable => NotionErrorClass::ConnectionUnavailable,
            Self::Forbidden => NotionErrorClass::Forbidden,
            Self::Upstream { .. } => NotionErrorClass::Upstream,
            Self::Decode(_) => NotionErrorClass::Decode,
            Self::IncompleteViewList => NotionErrorClass::IncompleteViewList,
            Self::Transport { .. } => NotionErrorClass::Transport,
        }
    }

    /// The HTTP status Notion answered with, when it is not implied by the
    /// kind.
    pub fn status(&self) -> Option<u16> {
        match self {
            Self::Upstream { status, .. } => Some(*status),
            Self::RateLimited { .. }
            | Self::NotFound
            | Self::AccessLost
            | Self::ConnectionUnavailable
            | Self::Forbidden
            | Self::Decode(_)
            | Self::IncompleteViewList
            | Self::Transport { .. } => None,
        }
    }

    /// Why the request did not complete, for a transport failure.
    pub fn transport_class(&self) -> Option<TransportClass> {
        match self {
            Self::Transport { class, .. } => Some(*class),
            Self::RateLimited { .. }
            | Self::NotFound
            | Self::AccessLost
            | Self::ConnectionUnavailable
            | Self::Forbidden
            | Self::Upstream { .. }
            | Self::Decode(_)
            | Self::IncompleteViewList => None,
        }
    }
}

/// The kind of a [`NotionError`], without its details.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::Display)]
#[strum(serialize_all = "snake_case")]
pub enum NotionErrorClass {
    /// [`NotionError::RateLimited`].
    RateLimited,
    /// [`NotionError::NotFound`].
    NotFound,
    /// [`NotionError::AccessLost`].
    AccessLost,
    /// [`NotionError::ConnectionUnavailable`].
    ConnectionUnavailable,
    /// [`NotionError::Forbidden`].
    Forbidden,
    /// [`NotionError::Upstream`].
    Upstream,
    /// [`NotionError::Decode`].
    Decode,
    /// [`NotionError::IncompleteViewList`].
    IncompleteViewList,
    /// [`NotionError::Transport`].
    Transport,
}

/// Why a request to Notion did not complete.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::Display)]
#[strum(serialize_all = "snake_case")]
pub enum TransportClass {
    /// The request or its response timed out.
    Timeout,
    /// No connection was made, including a failed TLS handshake.
    Connect,
    /// The response body could not be read.
    Body,
    /// The connection's grant must be authorized again.
    NeedsReauth,
    /// The user holds no Notion connection.
    NotConnected,
    /// Anything the connection does not tell apart.
    Other,
}

/// A user's Notion workspace, read through the REST API.
///
/// Implementations pace themselves to Notion's rate limit and retry rate
/// limited and transient failures, so callers may issue requests
/// concurrently.
pub trait NotionApi: Send + Sync + 'static {
    /// One page of a workspace search for `object`, most recently edited
    /// first.
    fn search(
        &self,
        object: SearchObject,
        cursor: Option<String>,
    ) -> impl Future<Output = Result<Paged<SearchHit>, NotionError>> + Send;

    /// A page and its property values.
    fn page(&self, id: &NotionId) -> impl Future<Output = Result<NotionPage, NotionError>> + Send;

    /// A page's body as markdown.
    fn page_markdown(
        &self,
        id: &NotionId,
    ) -> impl Future<Output = Result<PageMarkdown, NotionError>> + Send;

    /// A data source and its schema.
    fn data_source(
        &self,
        id: &NotionId,
    ) -> impl Future<Output = Result<NotionDataSource, NotionError>> + Send;

    /// The data sources of a database container.
    fn database_sources(
        &self,
        database: &NotionId,
    ) -> impl Future<Output = Result<Vec<NotionId>, NotionError>> + Send;

    /// One page of view references, scoped to a container or data source.
    /// Retrieve each reference separately to read its full configuration.
    fn list_views(
        &self,
        scope: &ViewScope,
        cursor: Option<String>,
    ) -> impl Future<Output = Result<Paged<NotionId>, NotionError>> + Send;

    /// One saved view, including its source, predicate, sorts and configuration.
    fn retrieve_view(
        &self,
        id: &NotionId,
    ) -> impl Future<Output = Result<NotionView, NotionError>> + Send;

    /// One page of a data source's rows, oldest first, saying whether more
    /// follow or Notion's result cap cut the rest off.
    fn query_data_source(
        &self,
        id: &NotionId,
        cursor: Option<String>,
    ) -> impl Future<Output = Result<RowsPage, NotionError>> + Send;

    /// One page of workspace members.
    fn users(
        &self,
        cursor: Option<String>,
    ) -> impl Future<Output = Result<Paged<NotionUser>, NotionError>> + Send;
}

/// Opens a user's Notion workspace.
pub trait NotionConnections: Send + Sync + 'static {
    /// The workspace client.
    type Api: NotionApi;

    /// The user's Notion workspace, or `None` when they have not connected
    /// Notion (or turned it off).
    fn for_user(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Self::Api>, NotionError>> + Send;
}

/// One connections value shared by several services, so they share its
/// per-account request pacing.
impl<Connections: NotionConnections> NotionConnections for std::sync::Arc<Connections> {
    type Api = Connections::Api;

    fn for_user(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Self::Api>, NotionError>> + Send {
        Connections::for_user(self, user)
    }
}
