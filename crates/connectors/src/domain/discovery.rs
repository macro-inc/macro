//! The catalog of connectable apps: browsing it, and what one app offers to
//! a user who has not connected it yet.
//!
//! A catalog entry names an app, never a source. Whether the user holds the
//! app comes from [`McpConnectionsService::connections`], the same answer
//! chat and agents get, never from a store's rows.

use crate::domain::models::{ConnectorId, ConnectorKey, Result, Status};
use crate::domain::service::McpConnectionsService;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// The page size when the caller names none.
const DEFAULT_PAGE_SIZE: u32 = 20;
/// The largest page a caller may ask for.
const MAX_PAGE_SIZE: u32 = 50;
/// The most advertised tools an inspection returns.
const MAX_TOOLS: usize = 100;

/// One connectable app.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogApp {
    /// The app.
    pub id: ConnectorId,
    /// Its display name.
    pub name: String,
    /// One line on what connecting it enables.
    pub description: Option<String>,
    /// Its icon, when the directory has one.
    pub icon_url: Option<String>,
    /// The directory's categories for it.
    pub categories: Vec<String>,
}

/// One page of the catalog, most popular first.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CatalogPage {
    /// The apps on this page, in display order.
    pub apps: Vec<CatalogApp>,
    /// The cursor for the next page; `None` on the last.
    pub next_cursor: Option<String>,
}

/// An action an app advertises. Listing it neither loads nor runs it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppTool {
    /// The upstream tool name.
    pub name: String,
    /// What it does.
    pub description: String,
}

/// What one app offers, and where the user stands with it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppDetails {
    /// The app.
    pub app: CatalogApp,
    /// The user's status, as the rules decide it.
    pub status: Status,
    /// The actions it advertises, at most [`MAX_TOOLS`].
    pub tools: Vec<AppTool>,
    /// Whether some advertised actions were left out.
    pub tools_truncated: bool,
}

/// The directory of connectable apps, as the user may browse it.
///
/// Object-safe (`#[async_trait]`) so [`Catalog`] names no adapter type.
#[async_trait::async_trait]
pub(crate) trait AppDirectory: Send + Sync {
    /// Apps matching `search` by name (all apps when `None`), most popular
    /// first, from `cursor`.
    async fn search(
        &self,
        user: &MacroUserIdStr<'static>,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<CatalogPage, rootcause::Report>;

    /// The app, or `None` when the directory has no connectable app by that
    /// identity.
    async fn retrieve(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Option<CatalogApp>, rootcause::Report>;

    /// The actions the app advertises, for a user who need not have
    /// connected it.
    async fn tools(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Vec<AppTool>, rootcause::Report>;
}

/// Browsing the catalog of connectable apps.
pub trait ConnectorCatalogService: Send + Sync + 'static {
    /// A page of apps matching `search` by name, or of every app. `limit`
    /// is clamped to 1..=50 and defaults to 20.
    fn search(
        &self,
        user: &MacroUserIdStr<'static>,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> impl Future<Output = Result<CatalogPage>> + Send;

    /// What `app` offers and the user's status with it; `None` when the
    /// catalog has no such app.
    fn inspect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> impl Future<Output = Result<Option<AppDetails>>> + Send;
}

/// The catalog over a directory, with statuses from the connection rules.
pub struct Catalog<C> {
    directory: Arc<dyn AppDirectory>,
    connections: C,
}

impl<C: Clone> Clone for Catalog<C> {
    fn clone(&self) -> Self {
        Self {
            directory: self.directory.clone(),
            connections: self.connections.clone(),
        }
    }
}

impl<C> Catalog<C> {
    /// The catalog over `directory`, asking `connections` for statuses.
    pub(crate) fn new(directory: Arc<dyn AppDirectory>, connections: C) -> Self {
        Self {
            directory,
            connections,
        }
    }
}

impl<C: McpConnectionsService> ConnectorCatalogService for Catalog<C> {
    #[tracing::instrument(name = "connectors.catalog_search", skip(self, user, search), err, fields(apps = tracing::field::Empty))]
    async fn search(
        &self,
        user: &MacroUserIdStr<'static>,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<CatalogPage> {
        let search = search.map(str::trim).filter(|search| !search.is_empty());
        let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
        let page = self.directory.search(user, search, cursor, limit).await?;
        tracing::Span::current().record("apps", page.apps.len());

        Ok(page)
    }

    #[tracing::instrument(name = "connectors.catalog_inspect", skip(self, user), err)]
    async fn inspect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Option<AppDetails>> {
        let Some(entry) = self.directory.retrieve(user, app).await? else {
            return Ok(None);
        };
        let (connections, tools) = futures::join!(
            self.connections.connections(user),
            self.directory.tools(user, app),
        );
        let status = connections?.status(&ConnectorKey::App(entry.id.clone()));
        let mut tools = tools?;
        let tools_truncated = tools.len() > MAX_TOOLS;
        tools.truncate(MAX_TOOLS);

        Ok(Some(AppDetails {
            app: entry,
            status,
            tools,
            tools_truncated,
        }))
    }
}
