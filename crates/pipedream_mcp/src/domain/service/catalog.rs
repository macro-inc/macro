//! Browsing the catalog of connectable MCP apps.
//!
//! The catalog is the user's directory: Macro Connect's catalog for a user
//! on Connect alone, otherwise Pipedream's app directory, ranked by
//! Pipedream's own popularity ordering (see the directory adapters). Clients render the
//! user's connected apps as their own section from the connections
//! endpoint; the catalog itself carries no curated pinning.

use crate::domain::models::{CatalogPage, MacroUserIdStr};
use crate::domain::ports::ConnectorDirectory;

#[cfg(test)]
mod test;

/// Bounds for the page size, applied to whatever the client asks for.
const MAX_PAGE_SIZE: u32 = 50;
const DEFAULT_PAGE_SIZE: u32 = 20;

/// Browse the connector catalog: popularity-ranked directory results,
/// optionally filtered by `search`.
#[tracing::instrument(skip(directory), err)]
pub async fn browse_catalog<D: ConnectorDirectory>(
    directory: &D,
    user_id: &MacroUserIdStr<'static>,
    search: Option<&str>,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> anyhow::Result<CatalogPage> {
    let search = search.map(str::trim).filter(|s| !s.is_empty());
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);

    directory.search(user_id, search, cursor, limit).await
}
