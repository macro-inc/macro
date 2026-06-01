//! One-off backfill: populate `task_duplicate_embedding` for existing tasks.
//!
//! Duplicate detection (see the `task_dedup` crate) only embeds a task into the
//! pgvector table when the task is *created*. Tasks that existed before that
//! feature shipped have no embedding, so new tasks can never match against them.
//! This binary walks every existing task document and upserts its embedding using
//! the exact same content shape and model the live pipeline uses
//! (`task_embedding_content` + `text-embedding-3-small`), so backfilled vectors
//! are directly comparable to ones written at create time.
//!
//! It only writes the vector table (`task_duplicate_embedding`). It does NOT run
//! duplicate detection or create `task_duplicate_match` rows.
//!
//! ## Production-scale behavior
//!
//! - **Tasks only**: an inner join on `document_sub_type = 'task'` — the same
//!   predicate the dedup pipeline uses — so plain markdown notes are excluded.
//! - **No double-inserts**: writes go through an upsert keyed on the
//!   `document_id` primary key, so re-runs update rather than duplicate.
//! - **Cancel / resume**: work is keyset-paginated by `Document.id` and each
//!   batch is upserted as soon as it is embedded. By default (no `--force`) the
//!   query skips tasks that already have an embedding, so a re-run after a
//!   Ctrl-C (or crash) simply continues with whatever is left — no checkpoint
//!   file required.
//! - **Never poisons the table**: embeddings come from [`OpenAiTaskEmbedder`],
//!   which errors instead of falling back to a local hash vector. On a transient
//!   error (429 / 5xx / network) the batch is retried with backoff and, if it
//!   still fails, left for the next run. On a hard rejection (e.g. an input over
//!   the token limit) the batch is split to isolate and drop only the offending
//!   task. Oversized content is also pre-truncated to stay under the limit.
//! - **Gentle on dependencies**: bounded concurrency for both lexical-service
//!   reads and OpenAI requests, and many tasks embedded per OpenAI request.
//!
//! ## Running
//!
//! Requires the same environment a `document_storage_service` deploy has:
//! `DATABASE_URL`, `LEXICAL_SERVICE_URL`, `INTERNAL_API_SECRET_KEY`, AWS creds
//! (to resolve the internal secret), and `OPENAI_API_KEY` (required — the
//! backfill refuses to run without it).
//!
//! ```bash
//! # dry run — counts tasks that would be embedded, touches nothing else
//! cargo run -p document_storage_service --bin backfill_task_embeddings -- --dry-run
//!
//! # real backfill (idempotent: skips tasks that already have an embedding)
//! cargo run -p document_storage_service --bin backfill_task_embeddings
//!
//! # re-embed every task, with tuned throughput
//! cargo run -p document_storage_service --bin backfill_task_embeddings -- \
//!     --force --batch-size 96 --request-concurrency 4 --lexical-concurrency 16
//! ```

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::Context;
use clap::Parser;
use futures::StreamExt;
use lexical_client::LexicalClient;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::SecretManager;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use task_dedup::TaskDedupConfig;
use task_dedup::domain::service::task_embedding_content;
use task_dedup::outbound::embedding::{EmbedError, OpenAiTaskEmbedder};
use task_dedup::outbound::postgres::{PgTaskDedupRepo, TaskEmbeddingUpsert};

/// Backfills task embeddings into the `task_duplicate_embedding` pgvector table.
#[derive(Debug, clap::Parser)]
#[command(name = "backfill_task_embeddings", about, long_about = None)]
struct Args {
    /// Re-embed every task, including ones that already have an embedding.
    #[arg(long)]
    force: bool,
    /// Count work without fetching content, embedding, or writing.
    #[arg(long)]
    dry_run: bool,
    /// Optional cap on the number of tasks processed (handy for a smoke test).
    #[arg(long)]
    limit: Option<usize>,
    /// Rows fetched from Postgres per keyset page.
    #[arg(long, default_value_t = 500, value_parser = clap::value_parser!(i64).range(1..))]
    page_size: i64,
    /// Task texts sent per OpenAI embeddings request.
    #[arg(long, default_value_t = 96, value_parser = positive_usize)]
    batch_size: usize,
    /// Concurrent OpenAI embedding requests.
    #[arg(long, default_value_t = 4, value_parser = positive_usize)]
    request_concurrency: usize,
    /// Concurrent lexical-service markdown fetches.
    #[arg(long, default_value_t = 16, value_parser = positive_usize)]
    lexical_concurrency: usize,
    /// Max characters of embedding content (keeps inputs under the token limit).
    //
    // text-embedding-3-small caps at 8191 tokens; ~4 chars/token, so 24k chars
    // (~6k tokens) stays comfortably under the limit.
    #[arg(long, default_value_t = 24_000, value_parser = positive_usize)]
    max_content_chars: usize,
}

/// Parses a `usize` and rejects zero (clap's `RangedU64ValueParser` doesn't
/// cover `usize`).
fn positive_usize(value: &str) -> Result<usize, String> {
    let parsed: usize = value
        .parse()
        .map_err(|_| format!("`{value}` is not an integer"))?;
    if parsed == 0 {
        return Err("value must be greater than 0".to_string());
    }
    Ok(parsed)
}

/// A task document selected for embedding.
struct TaskRow {
    document_id: String,
    name: String,
}

/// A task whose body has been fetched and is ready to embed. `truncated` is only
/// counted once the embedding is actually written, so it stays a subset of the
/// embedded total.
#[derive(Clone)]
struct Prepared {
    upsert: TaskEmbeddingUpsert,
    truncated: bool,
}

/// Running tallies for the backfill. Failures are split by whether a re-run can
/// fix them (`*_failed` / `*_retryable`) or not (`embed_dropped`), so the final
/// report shows whether the approach actually works rather than lumping all
/// failures together.
#[derive(Default)]
struct Counters {
    /// Embeddings successfully written.
    embedded: AtomicUsize,
    /// Successful embeddings whose content was truncated (subset of `embedded`).
    truncated: AtomicUsize,
    /// Couldn't fetch the task body from lexical-service. Retryable on re-run.
    lexical_failed: AtomicUsize,
    /// OpenAI transient errors (429/5xx) exhausted retries. Retryable on re-run.
    embed_retryable: AtomicUsize,
    /// OpenAI hard-rejected the input (e.g. over the token limit). A re-run will
    /// NOT fix these — this is the bucket that signals "can't embed this task".
    embed_dropped: AtomicUsize,
    /// Embedding produced but the DB upsert failed. Retryable on re-run.
    upsert_failed: AtomicUsize,
}

impl Counters {
    /// Failures that a re-run is expected to resolve.
    fn retryable(&self) -> usize {
        self.lexical_failed.load(Ordering::Relaxed)
            + self.embed_retryable.load(Ordering::Relaxed)
            + self.upsert_failed.load(Ordering::Relaxed)
    }
}

/// Formats `n` as a percentage of `total` with one decimal place.
fn pct(n: usize, total: usize) -> String {
    if total == 0 {
        return "0.0%".to_string();
    }
    format!("{:.1}%", (n as f64 / total as f64) * 100.0)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let args = Args::parse();
    let config = TaskDedupConfig::default();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let pool = PgPoolOptions::new()
        .min_connections(2)
        .max_connections((args.request_concurrency as u32 + 2).max(4))
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    let backlog = count_pending(&pool, args.force).await?;
    // `--limit` caps how many tasks we process, so cap the reported count too.
    let pending = match args.limit {
        Some(limit) => backlog.min(i64::try_from(limit).unwrap_or(i64::MAX)),
        None => backlog,
    };
    tracing::info!(
        pending,
        force = args.force,
        dry_run = args.dry_run,
        page_size = args.page_size,
        batch_size = args.batch_size,
        request_concurrency = args.request_concurrency,
        lexical_concurrency = args.lexical_concurrency,
        model = %config.embedding_model,
        "task embedding backfill starting"
    );

    if args.dry_run {
        tracing::info!(pending, "dry run: would embed this many tasks");
        return Ok(());
    }

    // Fail loudly if OpenAI isn't configured — a local fallback embedding would
    // silently poison the vector table.
    let embedder = Arc::new(OpenAiTaskEmbedder::from_env(
        config.embedding_model.clone(),
    )?);
    let lexical_client = Arc::new(build_lexical_client().await?);
    let repo = Arc::new(PgTaskDedupRepo::new(pool.clone()));
    let counters = Arc::new(Counters::default());

    let mut cursor = String::new();
    let mut processed = 0usize;
    loop {
        let remaining = args.limit.map(|limit| limit.saturating_sub(processed));
        if remaining == Some(0) {
            break;
        }
        let page_size = match remaining {
            Some(remaining) => args.page_size.min(remaining as i64),
            None => args.page_size,
        };

        let page = fetch_page(&pool, args.force, &cursor, page_size).await?;
        if page.is_empty() {
            break;
        }
        cursor = page.last().expect("page is non-empty").document_id.clone();
        processed += page.len();

        // 1. Fetch each task's markdown body (bounded concurrency).
        let prepared: Vec<Prepared> = futures::stream::iter(page)
            .map(|task| {
                let lexical_client = lexical_client.clone();
                let counters = counters.clone();
                let max_chars = args.max_content_chars;
                async move {
                    match fetch_task_markdown(&lexical_client, &task.document_id).await {
                        Ok(markdown) => {
                            let (content, truncated) =
                                build_content(&task.name, &markdown, max_chars);
                            Some(Prepared {
                                upsert: TaskEmbeddingUpsert {
                                    document_id: task.document_id,
                                    content,
                                    embedding: Vec::new(),
                                },
                                truncated,
                            })
                        }
                        Err(error) => {
                            counters.lexical_failed.fetch_add(1, Ordering::Relaxed);
                            tracing::warn!(
                                error = ?error,
                                document_id = %task.document_id,
                                "failed to fetch task markdown; will retry on next run"
                            );
                            None
                        }
                    }
                }
            })
            .buffer_unordered(args.lexical_concurrency)
            .filter_map(|item| async move { item })
            .collect()
            .await;

        // 2. Embed + upsert in batches (bounded concurrency).
        let model = config.embedding_model.clone();
        futures::stream::iter(prepared.chunks(args.batch_size).map(<[_]>::to_vec))
            .map(|batch| {
                let embedder = embedder.clone();
                let repo = repo.clone();
                let counters = counters.clone();
                let model = model.clone();
                async move { embed_and_upsert(&embedder, &repo, &model, batch, &counters).await }
            })
            .buffer_unordered(args.request_concurrency)
            .collect::<Vec<()>>()
            .await;

        let embedded = counters.embedded.load(Ordering::Relaxed);
        tracing::info!(
            processed,
            embedded,
            success_rate = %pct(embedded, processed),
            lexical_failed = counters.lexical_failed.load(Ordering::Relaxed),
            embed_retryable = counters.embed_retryable.load(Ordering::Relaxed),
            embed_dropped = counters.embed_dropped.load(Ordering::Relaxed),
            upsert_failed = counters.upsert_failed.load(Ordering::Relaxed),
            "backfill progress"
        );
    }

    report_summary(processed, &counters);
    Ok(())
}

/// Emits a final breakdown so the operator can see the failure rate as a cut of
/// total tasks and judge whether the backfill is working.
fn report_summary(processed: usize, counters: &Counters) {
    let embedded = counters.embedded.load(Ordering::Relaxed);
    let truncated = counters.truncated.load(Ordering::Relaxed);
    let lexical_failed = counters.lexical_failed.load(Ordering::Relaxed);
    let embed_retryable = counters.embed_retryable.load(Ordering::Relaxed);
    let embed_dropped = counters.embed_dropped.load(Ordering::Relaxed);
    let upsert_failed = counters.upsert_failed.load(Ordering::Relaxed);
    let retryable = counters.retryable();

    tracing::info!(
        total = processed,
        embedded,
        success_rate = %pct(embedded, processed),
        truncated,
        truncated_rate = %pct(truncated, processed),
        lexical_failed,
        embed_retryable,
        upsert_failed,
        retryable_failed = retryable,
        retryable_rate = %pct(retryable, processed),
        embed_dropped,
        dropped_rate = %pct(embed_dropped, processed),
        "task embedding backfill complete"
    );

    // Human-readable block — easy to eyeball the failure cut at the end of a run.
    tracing::info!(
        "{}",
        format!(
            concat!(
                "\n==== task embedding backfill summary ====\n",
                "  total tasks processed : {total}\n",
                "  embedded (success)    : {embedded} ({embedded_pct})\n",
                "    of which truncated  : {truncated} ({truncated_pct})\n",
                "  retryable failures    : {retryable} ({retryable_pct})  <- re-run the backfill to clear these\n",
                "    - lexical fetch     : {lexical_failed}\n",
                "    - openai transient  : {embed_retryable}\n",
                "    - db upsert         : {upsert_failed}\n",
                "  permanent drops       : {embed_dropped} ({dropped_pct})  <- re-run will NOT fix; content rejected by openai\n",
                "========================================="
            ),
            total = processed,
            embedded = embedded,
            embedded_pct = pct(embedded, processed),
            truncated = truncated,
            truncated_pct = pct(truncated, processed),
            retryable = retryable,
            retryable_pct = pct(retryable, processed),
            lexical_failed = lexical_failed,
            embed_retryable = embed_retryable,
            upsert_failed = upsert_failed,
            embed_dropped = embed_dropped,
            dropped_pct = pct(embed_dropped, processed),
        )
    );

    if retryable > 0 {
        tracing::warn!(
            retryable,
            "{} of tasks were left un-embedded by transient errors; re-run the backfill to retry them",
            pct(retryable, processed),
        );
    }
    if embed_dropped > 0 {
        tracing::warn!(
            embed_dropped,
            "{} of tasks could not be embedded at all (openai rejected the content); a re-run will not fix these",
            pct(embed_dropped, processed),
        );
    }
}

/// Counts tasks that would be embedded (used for `--dry-run` and the start log).
async fn count_pending(pool: &PgPool, force: bool) -> anyhow::Result<i64> {
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM "Document" d
        JOIN document_sub_type dst
          ON dst.document_id = d.id AND dst.sub_type = 'task'
        LEFT JOIN task_duplicate_embedding e ON e.document_id = d.id
        WHERE d."deletedAt" IS NULL
          AND ($1::bool OR e.document_id IS NULL)
        "#,
        force,
    )
    .fetch_one(pool)
    .await
    .context("failed to count task documents")?;
    Ok(count)
}

/// Fetches one keyset page of task documents ordered by id.
async fn fetch_page(
    pool: &PgPool,
    force: bool,
    cursor: &str,
    page_size: i64,
) -> anyhow::Result<Vec<TaskRow>> {
    let rows = sqlx::query!(
        r#"
        SELECT d.id AS "document_id!", d.name
        FROM "Document" d
        JOIN document_sub_type dst
          ON dst.document_id = d.id AND dst.sub_type = 'task'
        LEFT JOIN task_duplicate_embedding e ON e.document_id = d.id
        WHERE d."deletedAt" IS NULL
          AND ($1::bool OR e.document_id IS NULL)
          AND d.id > $2
        ORDER BY d.id
        LIMIT $3
        "#,
        force,
        cursor,
        page_size,
    )
    .fetch_all(pool)
    .await
    .context("failed to fetch task page")?;

    Ok(rows
        .into_iter()
        .map(|row| TaskRow {
            document_id: row.document_id,
            name: row.name,
        })
        .collect())
}

/// Builds the production embedding content and truncates it to `max_chars`.
/// Returns the content and whether it was truncated.
fn build_content(name: &str, markdown: &str, max_chars: usize) -> (String, bool) {
    let content = task_embedding_content(name, markdown);
    if content.chars().count() <= max_chars {
        return (content, false);
    }
    let truncated: String = content.chars().take(max_chars).collect();
    (truncated, true)
}

/// Embeds a batch and upserts the successful results, updating counters.
async fn embed_and_upsert(
    embedder: &OpenAiTaskEmbedder,
    repo: &PgTaskDedupRepo,
    model: &str,
    mut batch: Vec<Prepared>,
    counters: &Counters,
) {
    let contents: Vec<String> = batch
        .iter()
        .map(|item| item.upsert.content.clone())
        .collect();
    // embed_resilient records embed_retryable / embed_dropped for None slots.
    let embeddings = embed_resilient(embedder, &contents, counters).await;

    let mut upserts = Vec::with_capacity(batch.len());
    let mut truncated = 0usize;
    for (item, embedding) in batch.drain(..).zip(embeddings) {
        if let Some(embedding) = embedding {
            if item.truncated {
                truncated += 1;
            }
            upserts.push(TaskEmbeddingUpsert {
                embedding,
                ..item.upsert
            });
        }
    }

    if upserts.is_empty() {
        return;
    }

    match repo.bulk_upsert_embeddings(model, &upserts).await {
        Ok(()) => {
            counters
                .embedded
                .fetch_add(upserts.len(), Ordering::Relaxed);
            // Counted only now, so `truncated` stays a subset of `embedded`.
            counters.truncated.fetch_add(truncated, Ordering::Relaxed);
        }
        Err(error) => {
            // The rows weren't written, so count them as retryable for a re-run.
            counters
                .upsert_failed
                .fetch_add(upserts.len(), Ordering::Relaxed);
            tracing::error!(error = ?error, count = upserts.len(), "failed to upsert embeddings");
        }
    }
}

/// Embeds `contents`, returning one slot per input: `Some(vector)` on success,
/// `None` for inputs that couldn't be embedded this run.
///
/// The embedder ([`OpenAiTaskEmbedder`]) already retries rate limits and 5xx
/// responses with exponential backoff. A remaining [`EmbedError::Transient`]
/// leaves the whole batch for the next run; an [`EmbedError::Fatal`] (e.g. an
/// oversized input) splits the batch to isolate and drop only the offending
/// input(s).
type EmbedFuture<'a> = Pin<Box<dyn Future<Output = Vec<Option<Vec<f32>>>> + Send + 'a>>;

fn embed_resilient<'a>(
    embedder: &'a OpenAiTaskEmbedder,
    contents: &'a [String],
    counters: &'a Counters,
) -> EmbedFuture<'a> {
    Box::pin(async move {
        if contents.is_empty() {
            return Vec::new();
        }
        match embedder.embed_batch(contents).await {
            Ok(vectors) => vectors.into_iter().map(Some).collect(),
            Err(EmbedError::Transient(error)) => {
                tracing::warn!(
                    error,
                    "embeddings batch failed transiently; leaving for next run"
                );
                counters
                    .embed_retryable
                    .fetch_add(contents.len(), Ordering::Relaxed);
                vec![None; contents.len()]
            }
            Err(EmbedError::Fatal(error)) => {
                if contents.len() == 1 {
                    counters.embed_dropped.fetch_add(1, Ordering::Relaxed);
                    tracing::warn!(
                        error,
                        "dropping a task whose content OpenAI rejected (likely over the token limit)"
                    );
                    return vec![None];
                }
                let mid = contents.len() / 2;
                let mut left = embed_resilient(embedder, &contents[..mid], counters).await;
                let right = embed_resilient(embedder, &contents[mid..], counters).await;
                left.extend(right);
                left
            }
        }
    })
}

/// Reconstructs a task's markdown body from lexical-service's AI parse, joining
/// each node's human-readable content. This is the same source `read_content`
/// uses to feed markdown task bodies to the model.
async fn fetch_task_markdown(
    lexical_client: &LexicalClient,
    document_id: &str,
) -> anyhow::Result<String> {
    let parsed = lexical_client.parse_markdown_for_ai(document_id).await?;
    Ok(parsed
        .data
        .into_iter()
        .map(|node| node.content)
        .collect::<Vec<_>>()
        .join("\n"))
}

/// Builds the lexical-service client, resolving the internal auth secret exactly
/// like `main.rs` does so this works against local, develop, and prod.
async fn build_lexical_client() -> anyhow::Result<LexicalClient> {
    let lexical_service_url =
        std::env::var("LEXICAL_SERVICE_URL").context("LEXICAL_SERVICE_URL must be set")?;
    let env = Environment::new_or_prod();
    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );
    let internal_api_secret = secretsmanager_client
        .get_maybe_secret_value(env, InternalApiSecretKey::new()?)
        .await
        .context("unable to resolve internal api secret")?;
    Ok(LexicalClient::new(
        internal_api_secret.as_ref().to_string(),
        lexical_service_url,
    ))
}
