//! What the importer needs from Notion, and how a user's Notion is reached.

use std::future::Future;
use std::time::Duration;

use macro_user_id::user_id::MacroUserIdStr;

use super::model::{
    NotionDataSource, NotionId, NotionPage, NotionUser, PageMarkdown, Paged, SearchHit,
    SearchObject,
};

/// Why a Notion request failed.
#[derive(Debug, thiserror::Error)]
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
    /// The connection may not read this.
    #[error("the Notion connection may not read this object")]
    Forbidden,
    /// Notion answered with an error the importer does not handle.
    #[error("Notion could not complete the request: {body}")]
    Upstream {
        /// The HTTP status.
        status: u16,
        /// The response body, truncated.
        body: String,
    },
    /// Notion answered with a shape the importer could not read.
    #[error("unexpected Notion response: {0}")]
    Decode(String),
    /// The request did not complete.
    #[error("Notion request failed: {0:?}")]
    Transport(rootcause::Report),
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

    /// One page of a data source's rows, oldest first.
    fn query_data_source(
        &self,
        id: &NotionId,
        cursor: Option<String>,
    ) -> impl Future<Output = Result<Paged<NotionPage>, NotionError>> + Send;

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
