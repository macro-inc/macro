//! Backfill markdown document content state/location from sync-service state.
//!
//! This is intentionally a custom operational script, not a SQL migration:
//! deciding whether an existing markdown document is sync-backed requires an
//! external sync-service lookup. This script is intentionally conservative: it
//! only marks documents `ready / sync_service` when sync-service already has the
//! document. Pass `--initialize-missing` to initialize missing sync-service
//! documents from their uploaded object-storage markdown bytes.
//!
//! Dry-run is the default. Pass `--apply` to write updates.
//!
//! Required env vars:
//! - `DATABASE_URL`
//! - `SYNC_SERVICE_AUTH_KEY`
//! - `SYNC_SERVICE_URL`
//!
//! Additional env vars required for `--initialize-missing`:
//! - `DOCUMENT_STORAGE_BUCKET`
//! - `INTERNAL_API_SECRET_KEY`
//! - `LEXICAL_SERVICE_URL`
//!
//! Example dry-run:
//! `cargo run -p document_storage_service --bin backfill_markdown_content_location`
//!
//! Example apply:
//! `cargo run -p document_storage_service --bin backfill_markdown_content_location -- --apply`

use std::{env, time::Duration};

use anyhow::Context;
use documents_hex::domain::ports::markdown::MarkdownInitializationPort;
use documents_hex::outbound::markdown_init::LexicalSyncMarkdownInitializer;
use futures::stream::{self, StreamExt};
use lexical_client::LexicalClient;
use s3_key::build_cloud_storage_bucket_document_key;
use sqlx::{FromRow, postgres::PgPoolOptions};
use sync_service_client::SyncServiceClient;
use tokio::time::{sleep, timeout};

#[derive(Debug, Clone)]
struct Args {
    apply: bool,
    batch_size: i64,
    concurrency: usize,
    exists_retries: usize,
    exists_timeout_secs: u64,
    initialize_missing: bool,
    limit: Option<usize>,
    start_after: Option<String>,
}

impl Args {
    fn parse() -> anyhow::Result<Self> {
        let mut apply = false;
        let mut batch_size = 100_i64;
        let mut concurrency = 10_usize;
        let mut exists_retries = 2_usize;
        let mut exists_timeout_secs = 10_u64;
        let mut initialize_missing = false;
        let mut limit = None;
        let mut start_after = None;

        let mut args = env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--apply" => apply = true,
                "--initialize-missing" => initialize_missing = true,
                "--batch-size" => {
                    let value = args.next().context("--batch-size requires a value")?;
                    batch_size = value
                        .parse::<i64>()
                        .context("--batch-size must be an integer")?;
                    anyhow::ensure!(batch_size > 0, "--batch-size must be positive");
                }
                "--concurrency" => {
                    let value = args.next().context("--concurrency requires a value")?;
                    concurrency = value
                        .parse::<usize>()
                        .context("--concurrency must be an integer")?;
                    anyhow::ensure!(concurrency > 0, "--concurrency must be positive");
                }
                "--exists-retries" => {
                    let value = args.next().context("--exists-retries requires a value")?;
                    exists_retries = value
                        .parse::<usize>()
                        .context("--exists-retries must be an integer")?;
                }
                "--exists-timeout-secs" => {
                    let value = args
                        .next()
                        .context("--exists-timeout-secs requires a value")?;
                    exists_timeout_secs = value
                        .parse::<u64>()
                        .context("--exists-timeout-secs must be an integer")?;
                    anyhow::ensure!(
                        exists_timeout_secs > 0,
                        "--exists-timeout-secs must be positive"
                    );
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
                        "Usage: backfill_markdown_content_location [--apply] [--initialize-missing] [--batch-size N] [--concurrency N] [--exists-retries N] [--exists-timeout-secs N] [--limit N] [--start-after DOCUMENT_ID]"
                    );
                    std::process::exit(0);
                }
                other => anyhow::bail!("unknown argument: {other}"),
            }
        }

        Ok(Self {
            apply,
            batch_size,
            concurrency,
            exists_retries,
            exists_timeout_secs,
            initialize_missing,
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
    would_update: usize,
    updated: usize,
    would_initialize: usize,
    initialized: usize,
    object_missing: usize,
    object_read_errors: usize,
    invalid_utf8: usize,
    initialize_errors: usize,
    missing_document_instance: usize,
    sync_errors: usize,
}

#[derive(Debug, Default)]
struct BatchStats {
    scanned: usize,
    sync_exists: usize,
    sync_missing: usize,
    would_update: usize,
    updated: usize,
    would_initialize: usize,
    initialized: usize,
    object_missing: usize,
    object_read_errors: usize,
    invalid_utf8: usize,
    initialize_errors: usize,
    missing_document_instance: usize,
    sync_errors: usize,
}

impl Stats {
    fn add_batch(&mut self, batch: &BatchStats) {
        self.scanned += batch.scanned;
        self.sync_exists += batch.sync_exists;
        self.sync_missing += batch.sync_missing;
        self.would_update += batch.would_update;
        self.updated += batch.updated;
        self.would_initialize += batch.would_initialize;
        self.initialized += batch.initialized;
        self.object_missing += batch.object_missing;
        self.object_read_errors += batch.object_read_errors;
        self.invalid_utf8 += batch.invalid_utf8;
        self.initialize_errors += batch.initialize_errors;
        self.missing_document_instance += batch.missing_document_instance;
        self.sync_errors += batch.sync_errors;
    }
}

#[derive(Debug, FromRow)]
struct MarkdownCandidate {
    id: String,
    owner: String,
    document_instance_id: Option<i64>,
    uploaded: bool,
    content_state: String,
    content_location: Option<String>,
}

#[derive(Debug)]
enum CandidateResult {
    SyncExists { would_update: bool, updated: bool },
    SyncMissing,
    WouldInitialize,
    Initialized,
    ObjectMissing { key: String },
    ObjectReadError { key: String, error: String },
    InvalidUtf8 { key: String, error: String },
    InitializeError { key: String, error: String },
    MissingDocumentInstance,
    SyncError { error: String },
}

#[derive(Debug)]
struct CandidateOutcome {
    id: String,
    uploaded: bool,
    content_state: String,
    content_location: Option<String>,
    result: CandidateResult,
}

#[derive(Clone)]
struct InitializeMissingContext {
    document_storage_bucket: String,
    s3_client: aws_sdk_s3::Client,
    markdown_initializer: LexicalSyncMarkdownInitializer,
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

    tracing::info!(
        apply = args.apply,
        batch_size = args.batch_size,
        concurrency = args.concurrency,
        exists_retries = args.exists_retries,
        exists_timeout_secs = args.exists_timeout_secs,
        initialize_missing = args.initialize_missing,
        limit = args.limit,
        start_after = args.start_after,
        sync_service_url = %sync_service_url,
        "starting markdown content-location backfill"
    );

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("failed to connect to postgres")?;
    let sync_service_client = SyncServiceClient::new(sync_service_auth_key, sync_service_url);
    let initialize_missing_context = if args.initialize_missing {
        let document_storage_bucket = env::var("DOCUMENT_STORAGE_BUCKET")
            .context("DOCUMENT_STORAGE_BUCKET must be set when --initialize-missing is used")?;
        let internal_api_secret_key = env::var("INTERNAL_API_SECRET_KEY")
            .context("INTERNAL_API_SECRET_KEY must be set when --initialize-missing is used")?;
        let lexical_service_url = env::var("LEXICAL_SERVICE_URL")
            .context("LEXICAL_SERVICE_URL must be set when --initialize-missing is used")?;
        let sync_service_auth_key =
            env::var("SYNC_SERVICE_AUTH_KEY").context("SYNC_SERVICE_AUTH_KEY must be set")?;
        let sync_service_url =
            env::var("SYNC_SERVICE_URL").context("SYNC_SERVICE_URL must be set")?;

        Some(InitializeMissingContext {
            document_storage_bucket,
            s3_client: macro_aws_config::s3_client().await,
            markdown_initializer: LexicalSyncMarkdownInitializer::new(
                LexicalClient::new(internal_api_secret_key, lexical_service_url),
                SyncServiceClient::new(sync_service_auth_key, sync_service_url),
            ),
        })
    } else {
        None
    };

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

        let rows = sqlx::query_as::<_, MarkdownCandidate>(
            r#"
            SELECT
                d.id,
                d.owner,
                di.id AS document_instance_id,
                d.uploaded,
                d."contentState" AS content_state,
                d."contentLocation" AS content_location
            FROM "Document" d
            LEFT JOIN LATERAL (
                SELECT i.id
                FROM "DocumentInstance" i
                WHERE i."documentId" = d.id
                ORDER BY i."createdAt" DESC
                LIMIT 1
            ) di ON TRUE
            WHERE d."fileType" = 'md'
              AND (
                  d."contentState" IS DISTINCT FROM 'ready'
                  OR d."contentLocation" IS DISTINCT FROM 'sync_service'
              )
              AND ($1::text IS NULL OR d.id > $1)
            ORDER BY d.id
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

        tracing::info!(
            batch_len = rows.len(),
            batch_limit,
            "fetched markdown candidate batch"
        );

        last_id = rows.last().map(|row| row.id.clone());

        let outcomes = stream::iter(rows)
            .map(|row| {
                let db = db.clone();
                let sync_service_client = sync_service_client.clone();
                let initialize_missing_context = initialize_missing_context.clone();
                let exists_timeout = Duration::from_secs(args.exists_timeout_secs);
                async move {
                    process_candidate(
                        row,
                        sync_service_client,
                        db,
                        args.apply,
                        args.exists_retries,
                        exists_timeout,
                        initialize_missing_context,
                    )
                    .await
                }
            })
            .buffer_unordered(args.concurrency)
            .collect::<Vec<_>>()
            .await;

        let mut batch_stats = BatchStats::default();
        for outcome in outcomes {
            let outcome = outcome?;
            record_outcome(outcome, &mut batch_stats);
        }

        stats.add_batch(&batch_stats);

        tracing::info!(
            scanned = batch_stats.scanned,
            sync_exists = batch_stats.sync_exists,
            sync_missing = batch_stats.sync_missing,
            would_update = batch_stats.would_update,
            updated = batch_stats.updated,
            would_initialize = batch_stats.would_initialize,
            initialized = batch_stats.initialized,
            object_missing = batch_stats.object_missing,
            object_read_errors = batch_stats.object_read_errors,
            invalid_utf8 = batch_stats.invalid_utf8,
            initialize_errors = batch_stats.initialize_errors,
            missing_document_instance = batch_stats.missing_document_instance,
            sync_errors = batch_stats.sync_errors,
            total_scanned = stats.scanned,
            last_id = ?last_id,
            "processed markdown candidate batch"
        );
    }

    tracing::info!(
        scanned = stats.scanned,
        sync_exists = stats.sync_exists,
        sync_missing = stats.sync_missing,
        would_update = stats.would_update,
        updated = stats.updated,
        would_initialize = stats.would_initialize,
        initialized = stats.initialized,
        object_missing = stats.object_missing,
        object_read_errors = stats.object_read_errors,
        invalid_utf8 = stats.invalid_utf8,
        initialize_errors = stats.initialize_errors,
        missing_document_instance = stats.missing_document_instance,
        sync_errors = stats.sync_errors,
        last_id = ?last_id,
        apply = args.apply,
        "markdown content-location backfill complete"
    );

    Ok(())
}

async fn process_candidate(
    row: MarkdownCandidate,
    sync_service_client: SyncServiceClient,
    db: sqlx::Pool<sqlx::Postgres>,
    apply: bool,
    exists_retries: usize,
    exists_timeout: Duration,
    initialize_missing_context: Option<InitializeMissingContext>,
) -> anyhow::Result<CandidateOutcome> {
    let result = match sync_exists_with_retries(
        &sync_service_client,
        &row.id,
        exists_retries,
        exists_timeout,
    )
    .await
    {
        Ok(true) => {
            let would_update = !apply;
            let mut updated = false;

            if apply {
                let update_result = sqlx::query(
                    r#"
                    UPDATE "Document"
                    SET "contentState" = 'ready',
                        "contentLocation" = 'sync_service',
                        "updatedAt" = NOW()
                    WHERE id = $1
                    "#,
                )
                .bind(&row.id)
                .execute(&db)
                .await
                .with_context(|| format!("failed to update content location for {}", row.id))?;

                updated = update_result.rows_affected() > 0;
            }

            CandidateResult::SyncExists {
                would_update,
                updated,
            }
        }
        Ok(false) => {
            if let Some(context) = initialize_missing_context {
                initialize_missing_markdown(&row, &db, &context, apply).await
            } else {
                CandidateResult::SyncMissing
            }
        }
        Err(error) => CandidateResult::SyncError {
            error: format!("{error:?}"),
        },
    };

    Ok(CandidateOutcome {
        id: row.id,
        uploaded: row.uploaded,
        content_state: row.content_state,
        content_location: row.content_location,
        result,
    })
}

async fn initialize_missing_markdown(
    row: &MarkdownCandidate,
    db: &sqlx::Pool<sqlx::Postgres>,
    context: &InitializeMissingContext,
    apply: bool,
) -> CandidateResult {
    let Some(document_instance_id) = row.document_instance_id else {
        return CandidateResult::MissingDocumentInstance;
    };

    let key = build_cloud_storage_bucket_document_key(&row.owner, &row.id, document_instance_id);
    let markdown =
        match read_utf8_s3_object(&context.s3_client, &context.document_storage_bucket, &key).await
        {
            Ok(markdown) => markdown,
            Err(ReadMarkdownObjectError::Missing) => return CandidateResult::ObjectMissing { key },
            Err(ReadMarkdownObjectError::Read(error)) => {
                return CandidateResult::ObjectReadError { key, error };
            }
            Err(ReadMarkdownObjectError::InvalidUtf8(error)) => {
                return CandidateResult::InvalidUtf8 { key, error };
            }
        };

    if !apply {
        return CandidateResult::WouldInitialize;
    }

    match context
        .markdown_initializer
        .initialize_existing_markdown(&row.id, &markdown)
        .await
    {
        Ok(()) => {}
        Err(error) if sync_snapshot_already_exists(&error) => {}
        Err(error) => {
            return CandidateResult::InitializeError {
                key,
                error: error.to_string(),
            };
        }
    }

    match sqlx::query(
        r#"
        UPDATE "Document"
        SET "contentState" = 'ready',
            "contentLocation" = 'sync_service',
            "updatedAt" = NOW()
        WHERE id = $1
        "#,
    )
    .bind(&row.id)
    .execute(db)
    .await
    {
        Ok(_) => CandidateResult::Initialized,
        Err(error) => CandidateResult::InitializeError {
            key,
            error: format!("failed to update initialized document lifecycle: {error:?}"),
        },
    }
}

#[derive(Debug)]
enum ReadMarkdownObjectError {
    Missing,
    Read(String),
    InvalidUtf8(String),
}

async fn read_utf8_s3_object(
    s3_client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
) -> Result<String, ReadMarkdownObjectError> {
    let response = s3_client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|error| {
            if is_no_such_key_error(&error) {
                ReadMarkdownObjectError::Missing
            } else {
                ReadMarkdownObjectError::Read(format!("{error:?}"))
            }
        })?;

    let bytes = response
        .body
        .collect()
        .await
        .map_err(|error| ReadMarkdownObjectError::Read(format!("{error:?}")))?
        .into_bytes();

    String::from_utf8(bytes.to_vec())
        .map_err(|error| ReadMarkdownObjectError::InvalidUtf8(error.to_string()))
}

fn is_no_such_key_error(
    error: &aws_sdk_s3::error::SdkError<aws_sdk_s3::operation::get_object::GetObjectError>,
) -> bool {
    error
        .as_service_error()
        .is_some_and(|error| error.is_no_such_key())
}

fn sync_snapshot_already_exists(error: &documents_hex::domain::models::DocumentError) -> bool {
    error.to_string().contains("snapshot already exists")
}

async fn sync_exists_with_retries(
    sync_service_client: &SyncServiceClient,
    document_id: &str,
    retries: usize,
    request_timeout: Duration,
) -> anyhow::Result<bool> {
    let attempts = retries + 1;

    for attempt_index in 0..attempts {
        let attempt = attempt_index + 1;

        match timeout(request_timeout, sync_service_client.exists(document_id)).await {
            Ok(Ok(exists)) => return Ok(exists),
            Ok(Err(error)) if attempt < attempts => {
                tracing::debug!(
                    %document_id,
                    attempt,
                    attempts,
                    error = ?error,
                    "sync-service exists request failed; retrying"
                );
            }
            Ok(Err(error)) => {
                return Err(error).with_context(|| {
                    format!("sync-service exists request failed after {attempts} attempts")
                });
            }
            Err(error) if attempt < attempts => {
                tracing::debug!(
                    %document_id,
                    attempt,
                    attempts,
                    timeout_secs = request_timeout.as_secs(),
                    error = ?error,
                    "sync-service exists request timed out; retrying"
                );
            }
            Err(error) => {
                return Err(anyhow::anyhow!(error)).with_context(|| {
                    format!(
                        "sync-service exists request timed out after {attempts} attempts of {}s",
                        request_timeout.as_secs()
                    )
                });
            }
        }

        sleep(Duration::from_millis(250 * attempt as u64)).await;
    }

    unreachable!("retry loop should return before exhausting attempts")
}

fn record_outcome(outcome: CandidateOutcome, stats: &mut BatchStats) {
    stats.scanned += 1;

    match outcome.result {
        CandidateResult::SyncExists {
            would_update,
            updated,
        } => {
            stats.sync_exists += 1;
            if would_update {
                stats.would_update += 1;
            }
            if updated {
                stats.updated += 1;
            }

            tracing::debug!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                would_update,
                updated,
                "markdown document exists in sync-service; marking ready/sync_service"
            );
        }
        CandidateResult::SyncMissing => {
            stats.sync_missing += 1;
            tracing::debug!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                "markdown document does not exist in sync-service; leaving lifecycle unchanged"
            );
        }
        CandidateResult::WouldInitialize => {
            stats.sync_missing += 1;
            stats.would_initialize += 1;
            tracing::debug!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                "markdown document does not exist in sync-service; would initialize from object storage"
            );
        }
        CandidateResult::Initialized => {
            stats.sync_missing += 1;
            stats.initialized += 1;
            tracing::debug!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                "markdown document initialized in sync-service and marked ready/sync_service"
            );
        }
        CandidateResult::ObjectMissing { key } => {
            stats.sync_missing += 1;
            stats.object_missing += 1;
            tracing::debug!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                s3_key = %key,
                "markdown document missing sync-service state and object-storage source; leaving lifecycle unchanged"
            );
        }
        CandidateResult::ObjectReadError { key, error } => {
            stats.sync_missing += 1;
            stats.object_read_errors += 1;
            tracing::warn!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                s3_key = %key,
                error = %error,
                "failed to read markdown object for sync-service initialization; leaving lifecycle unchanged"
            );
        }
        CandidateResult::InvalidUtf8 { key, error } => {
            stats.sync_missing += 1;
            stats.invalid_utf8 += 1;
            tracing::warn!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                s3_key = %key,
                error = %error,
                "markdown object is not valid utf-8; leaving lifecycle unchanged"
            );
        }
        CandidateResult::InitializeError { key, error } => {
            stats.sync_missing += 1;
            stats.initialize_errors += 1;
            tracing::warn!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                s3_key = %key,
                error = %error,
                "failed to initialize markdown in sync-service; leaving lifecycle unchanged"
            );
        }
        CandidateResult::MissingDocumentInstance => {
            stats.sync_missing += 1;
            stats.missing_document_instance += 1;
            tracing::debug!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                "markdown document missing sync-service state and document instance; leaving lifecycle unchanged"
            );
        }
        CandidateResult::SyncError { error } => {
            stats.sync_errors += 1;
            tracing::warn!(
                document_id = %outcome.id,
                uploaded = outcome.uploaded,
                content_state = %outcome.content_state,
                content_location = ?outcome.content_location,
                error = %error,
                "failed to query sync-service; leaving lifecycle unchanged"
            );
        }
    }
}
