//! CLI for markdown document content lifecycle backfill.

use std::{env, time::Duration};

use anyhow::Context as _;
use clap::Parser;
use documents::domain::markdown_backfill::{
    MarkdownBackfillOptions, MarkdownBackfillReport, MarkdownBackfillService,
    MarkdownBackfillStats, MarkdownObjectReadError, MarkdownObjectReader,
};
use documents::domain::models::DocumentError;
use documents::domain::ports::markdown::MarkdownInitializationPort;
use documents::outbound::markdown_init::LexicalSyncMarkdownInitializer;
use documents::outbound::pg_document_repo::PgDocumentRepo;
use documents::outbound::s3_markdown_source::S3MarkdownObjectReader;
use lexical_client::LexicalClient;
use sqlx::postgres::PgPoolOptions;
use sync_service_client::SyncServiceClient;

/// Backfill markdown document content lifecycle from sync-service state.
#[derive(Clone, Debug, Parser)]
#[command(version, about)]
struct Args {
    /// Persist updates. Omit for dry-run.
    #[arg(long)]
    apply: bool,

    /// Initialize sync-service for missing markdown documents from S3 source bytes.
    #[arg(long)]
    initialize_missing: bool,

    /// Candidate rows fetched per DB batch.
    #[arg(long, default_value_t = 100)]
    batch_size: i64,

    /// Concurrent per-document sync/S3/init operations per batch.
    #[arg(long, default_value_t = 10)]
    concurrency: usize,

    /// Retries after the first sync-service exists attempt.
    #[arg(long, default_value_t = 2)]
    exists_retries: usize,

    /// Per-attempt sync-service exists timeout in seconds.
    #[arg(long, default_value_t = 10)]
    exists_timeout_secs: u64,

    /// Optional maximum candidate rows to scan.
    #[arg(long)]
    limit: Option<usize>,

    /// Optional exclusive document id cursor.
    #[arg(long)]
    start_after: Option<String>,
}

impl Args {
    fn options(&self) -> anyhow::Result<MarkdownBackfillOptions> {
        anyhow::ensure!(self.batch_size > 0, "--batch-size must be positive");
        anyhow::ensure!(self.concurrency > 0, "--concurrency must be positive");
        anyhow::ensure!(
            self.exists_timeout_secs > 0,
            "--exists-timeout-secs must be positive"
        );

        Ok(MarkdownBackfillOptions {
            apply: self.apply,
            batch_size: self.batch_size,
            concurrency: self.concurrency,
            exists_retries: self.exists_retries,
            exists_timeout: Duration::from_secs(self.exists_timeout_secs),
            limit: self.limit,
            start_after: self.start_after.clone(),
            initialize_missing: self.initialize_missing,
        })
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    macro_entrypoint::MacroEntrypoint::default().init();

    let args = Args::parse();
    let options = args.options()?;
    if !options.apply {
        tracing::warn!("dry-run mode: pass --apply to update Document.contentLocation");
    }

    let database_url = env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let sync_service_auth_key =
        env::var("SYNC_SERVICE_AUTH_KEY").context("SYNC_SERVICE_AUTH_KEY must be set")?;
    let sync_service_url = env::var("SYNC_SERVICE_URL").context("SYNC_SERVICE_URL must be set")?;

    tracing::info!(
        apply = options.apply,
        initialize_missing = options.initialize_missing,
        batch_size = options.batch_size,
        concurrency = options.concurrency,
        exists_retries = options.exists_retries,
        exists_timeout_secs = options.exists_timeout.as_secs(),
        limit = ?options.limit,
        start_after = ?options.start_after,
        sync_service_url = %sync_service_url,
        "starting markdown content-location backfill"
    );

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("failed to connect to postgres")?;

    let repo = PgDocumentRepo::new(db);
    let sync_probe =
        SyncServiceClient::new(sync_service_auth_key.clone(), sync_service_url.clone());
    let object_reader = build_object_reader(options.initialize_missing).await?;
    let markdown_initializer = build_markdown_initializer(
        options.apply && options.initialize_missing,
        sync_service_auth_key,
        sync_service_url,
    )?;

    let service =
        MarkdownBackfillService::new(repo, sync_probe, object_reader, markdown_initializer);
    let report = service.run(options.clone()).await?;

    tracing::info!(
        scanned = report.stats.scanned,
        sync_exists = report.stats.sync_exists,
        sync_missing = report.stats.sync_missing,
        would_update = report.stats.would_update,
        updated = report.stats.updated,
        would_initialize = report.stats.would_initialize,
        initialized = report.stats.initialized,
        object_missing = report.stats.object_missing,
        object_read_errors = report.stats.object_read_errors,
        invalid_utf8 = report.stats.invalid_utf8,
        initialize_errors = report.stats.initialize_errors,
        missing_document_instance = report.stats.missing_document_instance,
        sync_errors = report.stats.sync_errors,
        last_id = ?report.last_id,
        apply = options.apply,
        "markdown content-location backfill complete"
    );
    print_summary(&report, options.apply);

    Ok(())
}

fn build_markdown_initializer(
    enabled: bool,
    sync_service_auth_key: String,
    sync_service_url: String,
) -> anyhow::Result<OptionalMarkdownInitializer> {
    if !enabled {
        return Ok(OptionalMarkdownInitializer::Disabled);
    }

    let internal_api_secret_key = env::var("INTERNAL_API_SECRET_KEY")
        .context("INTERNAL_API_SECRET_KEY must be set when --initialize-missing is used")?;
    let lexical_service_url = env::var("LEXICAL_SERVICE_URL")
        .context("LEXICAL_SERVICE_URL must be set when --initialize-missing is used")?;

    Ok(OptionalMarkdownInitializer::Enabled(
        LexicalSyncMarkdownInitializer::new(
            LexicalClient::new(internal_api_secret_key, lexical_service_url),
            SyncServiceClient::new(sync_service_auth_key, sync_service_url),
        ),
    ))
}

async fn build_object_reader(enabled: bool) -> anyhow::Result<OptionalMarkdownObjectReader> {
    if !enabled {
        return Ok(OptionalMarkdownObjectReader::Disabled);
    }

    let document_storage_bucket = env::var("DOCUMENT_STORAGE_BUCKET")
        .context("DOCUMENT_STORAGE_BUCKET must be set when --initialize-missing is used")?;

    Ok(OptionalMarkdownObjectReader::Enabled(
        S3MarkdownObjectReader::new(document_storage_bucket, macro_aws_config::s3_client().await),
    ))
}

#[derive(Clone)]
enum OptionalMarkdownObjectReader {
    Disabled,
    Enabled(S3MarkdownObjectReader),
}

impl MarkdownObjectReader for OptionalMarkdownObjectReader {
    async fn read_markdown(
        &self,
        candidate: &documents::domain::markdown_backfill::MarkdownBackfillCandidate,
    ) -> Result<String, MarkdownObjectReadError> {
        match self {
            Self::Disabled => Err(MarkdownObjectReadError::Read {
                key: "<disabled>".to_string(),
                error: "markdown object reader disabled".to_string(),
            }),
            Self::Enabled(reader) => reader.read_markdown(candidate).await,
        }
    }
}

#[derive(Clone)]
enum OptionalMarkdownInitializer {
    Disabled,
    Enabled(LexicalSyncMarkdownInitializer),
}

impl MarkdownInitializationPort for OptionalMarkdownInitializer {
    async fn initialize_existing_markdown(
        &self,
        document_id: &str,
        markdown: &str,
    ) -> Result<(), DocumentError> {
        match self {
            Self::Disabled => Err(DocumentError::Internal(anyhow::anyhow!(
                "markdown initializer disabled"
            ))),
            Self::Enabled(initializer) => {
                initializer
                    .initialize_existing_markdown(document_id, markdown)
                    .await
            }
        }
    }
}

fn print_summary(report: &MarkdownBackfillReport, apply: bool) {
    let MarkdownBackfillStats {
        scanned,
        sync_exists,
        sync_missing,
        would_update,
        updated,
        would_initialize,
        initialized,
        object_missing,
        object_read_errors,
        invalid_utf8,
        initialize_errors,
        missing_document_instance,
        sync_errors,
    } = report.stats;

    println!("\nMarkdown backfill summary");
    println!("  apply: {apply}");
    println!("  scanned: {scanned}");
    println!("  sync_exists: {sync_exists}");
    println!("  sync_missing: {sync_missing}");
    println!("  would_update: {would_update}");
    println!("  updated: {updated}");
    println!("  would_initialize: {would_initialize}");
    println!("  initialized: {initialized}");
    println!("  object_missing: {object_missing}");
    println!("  object_read_errors: {object_read_errors}");
    println!("  invalid_utf8: {invalid_utf8}");
    println!("  initialize_errors: {initialize_errors}");
    println!("  missing_document_instance: {missing_document_instance}");
    println!("  sync_errors: {sync_errors}");
    println!("  last_id: {:?}", report.last_id);
}
