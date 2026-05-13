//! Backfill markdown document content locations from sync-service state.
//!
//! This is intentionally a custom operational script, not a SQL migration:
//! deciding whether an existing markdown document is sync-backed requires an
//! external sync-service lookup.
//!
//! Dry-run is the default. Pass `--apply` to write updates.
//!
//! Required env vars:
//! - `DATABASE_URL`
//! - `SYNC_SERVICE_AUTH_KEY`
//! - `SYNC_SERVICE_URL`
//!
//! Example dry-run:
//! `cargo run -p document_storage_service --bin backfill_markdown_content_location`
//!
//! Example apply:
//! `cargo run -p document_storage_service --bin backfill_markdown_content_location -- --apply`

use std::env;

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use sync_service_client::SyncServiceClient;

#[derive(Debug, Clone)]
struct Args {
    apply: bool,
    batch_size: i64,
    limit: Option<usize>,
    start_after: Option<String>,
}

impl Args {
    fn parse() -> anyhow::Result<Self> {
        let mut apply = false;
        let mut batch_size = 100_i64;
        let mut limit = None;
        let mut start_after = None;

        let mut args = env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--apply" => apply = true,
                "--batch-size" => {
                    let value = args.next().context("--batch-size requires a value")?;
                    batch_size = value
                        .parse::<i64>()
                        .context("--batch-size must be an integer")?;
                    anyhow::ensure!(batch_size > 0, "--batch-size must be positive");
                }
                "--limit" => {
                    let value = args.next().context("--limit requires a value")?;
                    limit = Some(
                        value
                            .parse::<usize>()
                            .context("--limit must be an integer")?,
                    );
                }
                "--start-after" => {
                    start_after = Some(args.next().context("--start-after requires a value")?);
                }
                "--help" | "-h" => {
                    println!(
                        "Usage: backfill_markdown_content_location [--apply] [--batch-size N] [--limit N] [--start-after DOCUMENT_ID]"
                    );
                    std::process::exit(0);
                }
                other => anyhow::bail!("unknown argument: {other}"),
            }
        }

        Ok(Self {
            apply,
            batch_size,
            limit,
            start_after,
        })
    }
}

#[derive(Debug, Default)]
struct Stats {
    scanned: usize,
    sync_exists: usize,
    sync_missing: usize,
    updated: usize,
    sync_errors: usize,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    macro_entrypoint::MacroEntrypoint::default().init();

    let args = Args::parse()?;
    if !args.apply {
        tracing::warn!("dry-run mode: pass --apply to update Document.contentLocation");
    }

    let database_url = env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let sync_service_auth_key =
        env::var("SYNC_SERVICE_AUTH_KEY").context("SYNC_SERVICE_AUTH_KEY must be set")?;
    let sync_service_url = env::var("SYNC_SERVICE_URL").context("SYNC_SERVICE_URL must be set")?;

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("failed to connect to postgres")?;
    let sync_service_client = SyncServiceClient::new(sync_service_auth_key, sync_service_url);

    let mut stats = Stats::default();
    let mut last_id = args.start_after;

    loop {
        if args.limit.is_some_and(|limit| stats.scanned >= limit) {
            break;
        }

        let remaining_limit = args
            .limit
            .map(|limit| limit.saturating_sub(stats.scanned) as i64)
            .unwrap_or(args.batch_size);
        let batch_limit = args.batch_size.min(remaining_limit);
        if batch_limit == 0 {
            break;
        }

        let rows = sqlx::query_scalar::<_, String>(
            r#"
            SELECT id
            FROM "Document"
            WHERE "fileType" = 'md'
              AND uploaded = true
              AND "contentState" = 'ready'
              AND "contentLocation" IS DISTINCT FROM 'sync_service'
              AND ($1::text IS NULL OR id > $1)
            ORDER BY id
            LIMIT $2
            "#,
        )
        .bind(last_id.as_deref())
        .bind(batch_limit)
        .fetch_all(&db)
        .await
        .context("failed to fetch markdown document batch")?;

        if rows.is_empty() {
            break;
        }

        for document_id in rows {
            last_id = Some(document_id.clone());
            stats.scanned += 1;

            match sync_service_client.exists(&document_id).await {
                Ok(true) => {
                    stats.sync_exists += 1;
                    tracing::info!(%document_id, "markdown document exists in sync-service");

                    if args.apply {
                        let result = sqlx::query(
                            r#"
                            UPDATE "Document"
                            SET "contentState" = 'ready',
                                "contentLocation" = 'sync_service',
                                "updatedAt" = NOW()
                            WHERE id = $1
                            "#,
                        )
                        .bind(&document_id)
                        .execute(&db)
                        .await
                        .with_context(|| {
                            format!("failed to update content location for {document_id}")
                        })?;

                        if result.rows_affected() > 0 {
                            stats.updated += 1;
                        }
                    }
                }
                Ok(false) => {
                    stats.sync_missing += 1;
                    tracing::info!(%document_id, "markdown document does not exist in sync-service; leaving location unchanged");
                }
                Err(error) => {
                    stats.sync_errors += 1;
                    tracing::warn!(%document_id, error=?error, "failed to query sync-service; leaving location unchanged");
                }
            }
        }
    }

    tracing::info!(
        scanned = stats.scanned,
        sync_exists = stats.sync_exists,
        sync_missing = stats.sync_missing,
        updated = stats.updated,
        sync_errors = stats.sync_errors,
        apply = args.apply,
        "markdown content-location backfill complete"
    );

    Ok(())
}
