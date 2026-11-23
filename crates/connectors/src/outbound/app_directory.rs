//! The catalog's directory over the hosted app directory: the apps users
//! browse, and the actions each advertises before it is connected.

use crate::domain::discovery::{AppDirectory, AppTool, CatalogApp, CatalogPage};
use crate::domain::models::ConnectorId;
use crate::outbound::pipedream::models::{CatalogEntry, CatalogPage as DirectoryPage};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::compat::IntoRootcause as _;
use std::collections::HashSet;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Port for browsing the directory of connectable apps. Pipedream's
/// directory is the catalog, whatever source a user connects an app through.
pub(crate) trait ConnectorDirectory: Send + Sync + 'static {
    /// Search the directory.
    ///
    /// `search` filters apps by name; `None` browses everything. `cursor` is
    /// the opaque pagination cursor from a previous page. Implementations
    /// return entries most-popular-first, and only apps that can actually be
    /// connected and used (i.e. apps with an auth flow and at least one
    /// action to expose as a tool) and that the catalog doesn't hide.
    fn search(
        &self,
        user_id: &MacroUserIdStr<'static>,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> impl Future<Output = anyhow::Result<DirectoryPage>> + Send;

    /// Look up one app by its name slug.
    ///
    /// `Ok(None)` when Pipedream has no connectable app under that exact slug:
    /// unknown, an app with no auth flow (nothing to connect), or one the
    /// catalog hides. A lookup that cannot be completed is an error, not a
    /// miss.
    fn retrieve(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> impl Future<Output = anyhow::Result<Option<CatalogEntry>>> + Send;
}

/// Read an app's advertised capabilities without invoking any of its tools.
pub(crate) trait ConnectorCapabilities: Send + Sync + 'static {
    /// List tools, including for apps this user has not connected yet.
    fn tools(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> impl Future<Output = anyhow::Result<Vec<crate::domain::discovery::AppTool>>> + Send;
}

/// [`AppDirectory`] over a hosted directory and its capability listing.
pub(crate) struct HostedAppDirectory<D> {
    directory: Arc<D>,
}

impl<D> HostedAppDirectory<D> {
    /// The catalog's directory over `directory`.
    pub(crate) fn new(directory: Arc<D>) -> Self {
        Self { directory }
    }
}

/// The entry as a catalog app, or `None` for a slug that names no app.
fn catalog_app(entry: CatalogEntry) -> Option<CatalogApp> {
    let id = ConnectorId::parse(&entry.app_slug)
        .inspect_err(|error| tracing::warn!(error = ?error, "skipping a directory entry whose slug is not an app"))
        .ok()?;

    Some(CatalogApp {
        id,
        name: entry.display_name,
        description: entry.description,
        icon_url: entry.icon_url,
        categories: entry.categories,
        // The catalog adds the setup from the source that connects the app.
        org_setup: None,
    })
}

#[async_trait::async_trait]
impl<D> AppDirectory for HostedAppDirectory<D>
where
    D: ConnectorDirectory + ConnectorCapabilities,
{
    async fn search(
        &self,
        user: &MacroUserIdStr<'static>,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<CatalogPage, Report> {
        let page = self
            .directory
            .search(user, search, cursor, limit)
            .await
            .into_rootcause()?;

        // An alias folds into the app it names (rule 4), so the page lists
        // that app once.
        let mut seen = HashSet::new();
        let apps = page
            .entries
            .into_iter()
            .filter_map(catalog_app)
            .filter(|app| seen.insert(app.id.clone()))
            .collect();

        Ok(CatalogPage {
            apps,
            next_cursor: page.next_cursor,
        })
    }

    async fn retrieve(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Option<CatalogApp>, Report> {
        let entry = self
            .directory
            .retrieve(user, app.as_str())
            .await
            .into_rootcause()?;

        Ok(entry.and_then(catalog_app))
    }

    async fn tools(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Vec<AppTool>, Report> {
        self.directory
            .tools(user, app.as_str())
            .await
            .into_rootcause()
    }
}

/// The directory of a process without Pipedream: no apps.
pub(crate) struct NoAppDirectory;

#[async_trait::async_trait]
impl AppDirectory for NoAppDirectory {
    async fn search(
        &self,
        _user: &MacroUserIdStr<'static>,
        _search: Option<&str>,
        _cursor: Option<&str>,
        _limit: u32,
    ) -> Result<CatalogPage, Report> {
        Ok(CatalogPage::default())
    }

    async fn retrieve(
        &self,
        _user: &MacroUserIdStr<'static>,
        _app: &ConnectorId,
    ) -> Result<Option<CatalogApp>, Report> {
        Ok(None)
    }

    async fn tools(
        &self,
        _user: &MacroUserIdStr<'static>,
        _app: &ConnectorId,
    ) -> Result<Vec<AppTool>, Report> {
        Ok(Vec::new())
    }
}
