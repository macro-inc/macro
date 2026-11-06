//! Clean existing stored protocol frames in bounded keyset batches.

use std::{num::NonZeroUsize, time::Duration};

use agent_session::domain::scrub_log_credentials::scrub_log_credentials;
use agent_session::outbound::postgres::PgAgentSessionRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use clap::Parser;
use entity_registry::OwnerGrantPolicy;
use entity_registry_db_utils::OwnedEntityRegistrar;
use macro_uuid::Uuid;
use sqlx::postgres::PgPoolOptions;
use tracing::Instrument;

#[derive(Parser)]
struct Args {
    /// MacroDB to clean. Never logged.
    #[arg(long)]
    database_url: String,
    /// Maximum rows in each batch.
    #[arg(long, default_value = "100")]
    limit: NonZeroUsize,
    /// Resume after this log row id.
    #[arg(long)]
    after_id: Option<Uuid>,
    /// Write changed rows. The default is a dry run.
    #[arg(long)]
    apply: bool,
    /// Pause between batches.
    #[arg(long, default_value_t = 0)]
    pause_ms: u64,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    run(args)
        .instrument(tracing::info_span!(
            "agent_session.scrub_log_credentials",
            examined = tracing::field::Empty,
            changed = tracing::field::Empty,
            last_id = tracing::field::Empty,
        ))
        .await
}

async fn run(args: Args) -> Result<(), rootcause::Report> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&args.database_url)
        .await
        .map_err(|_| rootcause::Report::new(std::io::Error::other("database connection failed")))?;
    let repo = PgAgentSessionRepo::new(
        pool.clone(),
        OwnedEntityRegistrar::new(OwnerGrantPolicy::new(PgBotsRepo::new(pool))),
    );
    let span = tracing::Span::current();
    let mut examined = 0;
    let mut changed = 0;
    let mut last_id = args.after_id;

    loop {
        let batch = scrub_log_credentials(&repo, last_id, args.limit, args.apply)
            .await
            .map_err(rootcause::Report::new)?;
        examined += batch.examined;
        changed += batch.changed;
        last_id = batch.last_id.or(last_id);
        span.record("examined", examined);
        span.record("changed", changed);
        if let Some(id) = last_id {
            span.record("last_id", tracing::field::display(id));
        }
        if batch.examined < args.limit.get() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(args.pause_ms)).await;
    }

    let last_id = last_id.map_or_else(|| "none".to_owned(), |id| id.to_string());
    println!("examined={examined} changed={changed} last_id={last_id}");
    Ok(())
}
