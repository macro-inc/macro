//! The `mcp_overlays` table: catalog apps served by the vendor's own MCP
//! server through the native source.

use crate::domain::catalog::Overlays;
use crate::domain::models::{ConnectorId, ServerUrl};
use crate::domain::ports::OverlayCatalog;
use rootcause::Report;
use sqlx::PgPool;
use std::time::{Duration, Instant};

#[cfg(test)]
mod test;

/// How long a read of the table is reused. Rows change only with a
/// migration, and every resolution reads them.
const OVERLAYS_TTL: Duration = Duration::from_secs(5 * 60);

/// [`OverlayCatalog`] over `mcp_overlays`, cached.
pub(crate) struct PgOverlayCatalog {
    pool: PgPool,
    cached: tokio::sync::Mutex<Option<(Instant, Overlays)>>,
}

impl PgOverlayCatalog {
    /// The overlay table in `pool`.
    pub(crate) fn new(pool: PgPool) -> Self {
        Self {
            pool,
            cached: tokio::sync::Mutex::new(None),
        }
    }

    #[tracing::instrument(skip_all, err)]
    async fn read(&self) -> Result<Overlays, Report> {
        let rows = sqlx::query!("SELECT app_slug, server_url FROM mcp_overlays ORDER BY app_slug")
            .fetch_all(&self.pool)
            .await
            .map_err(Report::new)?;

        // The table's checks admit only valid slugs and https URLs; a row
        // that still fails to parse is skipped, not allowed to hide the rest.
        let entries = rows.into_iter().filter_map(|row| {
            let app = ConnectorId::parse(&row.app_slug)
                .inspect_err(|error| tracing::warn!(error = ?error, "skipping an overlay"))
                .ok()?;
            let url = ServerUrl::parse(&row.server_url)
                .inspect_err(|error| tracing::warn!(error = ?error, "skipping an overlay"))
                .ok()?;
            Some((app, url))
        });
        Ok(Overlays::new(entries))
    }
}

impl OverlayCatalog for PgOverlayCatalog {
    async fn overlays(&self) -> Result<Overlays, Report> {
        // Held across the read so concurrent misses make one query.
        let mut cached = self.cached.lock().await;
        if let Some((read_at, overlays)) = cached.as_ref()
            && read_at.elapsed() < OVERLAYS_TTL
        {
            return Ok(overlays.clone());
        }

        let overlays = self.read().await?;
        *cached = Some((Instant::now(), overlays.clone()));
        Ok(overlays)
    }
}
