//! # Outlook Folder Re-import
//!
//! Starts a fresh delta round for every Outlook folder whose round started at
//! an older folder reader revision (`FolderChangeReader::READER_REVISION`),
//! so mail that round missed is imported. Folder delta rounds were capped at
//! a folder's newest 100 messages before revision 1. The pubsub workers do
//! the import; this only restarts folder streams, one phase at a time per
//! link (Inbox and Sent, then every other folder), and waits for each phase's
//! import run to finish. Procedure: `docs/runbooks/outlook-folder-reimport.md`.
//!
//! Each folder stream records the revision its round started at, so a rerun
//! skips folders already re-read and links still importing; stopping it
//! leaves started imports to finish on their own.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//!
//! ## Optional Environment Variables:
//! - `LINK_IDS`: Comma-separated link IDs, visited in this order.
//! - `ALL_LINKS`: When `true`, visit every Outlook link, oldest connection
//!   first. A real run needs `LINK_IDS` or `ALL_LINKS=true` (not both), so a
//!   run with neither refuses and changes nothing.
//! - `CONCURRENCY`: Links re-importing at once (defaults to 1, capped at 10).
//! - `VERIFY`: When `true`, read-only mode: reports what each link would do
//!   and changes nothing. Without `LINK_IDS` it reports every Outlook link.

mod config;

use email::domain::mailbox::reimport::{FolderReimportService, LinkOutcome};
use email::outbound::mailbox_pg::PgMailboxSync;
use email_api_client::{OutlookApiClientRepository, domain::ports::FolderChangeReader};
use macro_entrypoint::MacroEntrypoint;
use rootcause::prelude::{Report, ResultExt as _};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::collections::BTreeMap;
use std::str::FromStr as _;

#[tokio::main]
async fn main() -> Result<(), Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> Result<(), Report> {
    let config = config::Config::from_env()?;
    // Every query here is bounded by one link; the timeouts keep a restart
    // from queueing behind a long lock on a busy mailbox's rows.
    let connect = PgConnectOptions::from_str(&config.database_url)
        .context("DATABASE_URL is not a Postgres connection string")?
        .options([("lock_timeout", "5s"), ("statement_timeout", "30s")]);
    let db_pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(u32::try_from(config.concurrency + 1).unwrap_or(u32::MAX))
        .connect_with(connect)
        .await
        .context("could not connect to the database")?;

    let service = FolderReimportService::new(
        PgMailboxSync::new(db_pool),
        <OutlookApiClientRepository as FolderChangeReader>::READER_REVISION,
    );
    let links = service
        .links(config.link_ids)
        .await
        .context("could not list Outlook links")?;
    tracing::info!(
        links = links.len(),
        concurrency = config.concurrency,
        mode = ?config.mode,
        "outlook folder reimport starting"
    );
    let results = service.run(links, config.concurrency, config.mode).await;

    let mut outcomes: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut failures = Vec::new();
    for (link_id, result) in &results {
        match result {
            Ok(outcome) => *outcomes.entry(<&'static str>::from(*outcome)).or_default() += 1,
            Err(_) => failures.push(link_id.to_string()),
        }
    }
    let interrupted = results
        .iter()
        .filter(|(_, result)| matches!(result, Ok(LinkOutcome::Interrupted)))
        .count();
    tracing::info!(
        ?outcomes,
        failures = failures.len(),
        interrupted,
        "outlook folder reimport finished"
    );
    if !failures.is_empty() {
        rootcause::bail!(
            "{} links failed ({}); rerun with LINK_IDS to retry them",
            failures.len(),
            failures.join(", ")
        );
    }
    Ok(())
}
