//! Browsing the catalog of connectable MCP apps.
//!
//! The catalog is Pipedream's app directory, ranked by Pipedream's own
//! popularity ordering (see the directory adapter). Clients render the
//! user's connected apps as their own section from the connections
//! endpoint; the catalog itself carries no curated pinning.

use crate::domain::models::CatalogPage;
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
    search: Option<&str>,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> anyhow::Result<CatalogPage> {
    let search = search.map(str::trim).filter(|s| !s.is_empty());
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);

    directory.search(search, cursor, limit).await
}
