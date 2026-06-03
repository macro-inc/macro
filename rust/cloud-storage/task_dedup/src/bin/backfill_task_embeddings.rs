use std::borrow::Cow;
use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::Context as _;
use anyhow::{Result, anyhow, bail};
use clap::Parser;
use embedding::embedding_provider::openai::TextEmbedding3Small;
use embedding::entity::Task;
use embedding::{EmbeddingModel, VectorStore};
use futures::StreamExt;
use lexical_client::LexicalClient;
use macro_env_var::env_var;
use secretsmanager_client::{SecretManager, SecretsManager};
use task_dedup::outbound::postgres::PgTaskVectorDb;

/// Target environment for the backfill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum Env {
    /// Local development: read all config from the environment / `.env`.
    Local,
    /// Dev environment: resolve DB URL and secrets from AWS.
    Dev,
    /// Production environment: resolve DB URL and secrets from AWS.
    Prod,
}

impl Env {
    /// The environment suffix used in per-environment secret names
    /// (e.g. `macrodb-password-dev`).
    fn suffix(self) -> &'static str {
        match self {
            Env::Local => "local",
            Env::Dev => "dev",
            Env::Prod => "prod",
        }
    }

    /// Hard-coded lexical-service URL for the environment.
    fn lexical_service_url(self) -> &'static str {
        match self {
            Env::Local => "http://localhost:8096",
            Env::Dev => "https://lexical-service-dev.macroverse.workers.dev",
            Env::Prod => "https://lexical-service.macroverse.workers.dev",
        }
    }
}

/// Backfills task embeddings into the `task_duplicate_embedding` pgvector table.
#[derive(Debug, clap::Parser)]
#[command(name = "backfill_task_embeddings", about, long_about = None)]
struct Args {
    /// Environment to run against: local | dev | prod.
    #[arg(value_enum)]
    env: Env,
    /// Re-embed every task, including ones that already have an embedding.
    #[arg(long)]
    force: bool,
    /// Count work without fetching content, embedding, or writing.
    #[arg(long)]
    dry_run: bool,
    /// Delete existing embedding set
    #[arg(long)]
    clear: bool,
    /// Optional cap on the number of tasks processed (handy for a smoke test).
    #[arg(long)]
    limit: Option<usize>,
    /// Number of tasks to embed and write concurrently.
    #[arg(long, default_value_t = 8)]
    concurrency: usize,
}

/// Running tallies for the backfill. Failures are split by stage so the final
/// report shows where work was lost; `*_failed` failures are all retryable by
/// re-running (the embedding client does not distinguish permanent rejections).
#[derive(Default)]
struct Counters {
    /// Embeddings successfully written.
    succeeded: AtomicUsize,
    /// Failed
    failed: AtomicUsize,
    /// Total
    total: AtomicUsize,
}

#[derive(Default, Clone)]
struct Stats(Arc<Counters>);

impl Stats {
    /// Records a failure and returns the running count of tasks processed so far.
    pub fn fail(&self) -> usize {
        self.0.failed.fetch_add(1, Ordering::Relaxed);
        self.0.total.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Records a success and returns the running count of tasks processed so far.
    pub fn success(&self) -> usize {
        self.0.succeeded.fetch_add(1, Ordering::Relaxed);
        self.0.total.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn summary(&self) {
        println!("________________________________________");
        println!(
            "succeeded: {}/{}",
            self.0.succeeded.load(Ordering::Relaxed),
            self.0.total.load(Ordering::Relaxed)
        );
        println!(
            "failed: {}/{}",
            self.0.failed.load(Ordering::Relaxed),
            self.0.total.load(Ordering::Relaxed)
        );
        println!("________________________________________");
    }
}

fn confirm(s: &str) -> Result<()> {
    println!("{}", s);
    print!("Confirm [y/n]: ");
    std::io::stdout().flush()?;
    let mut buf = String::new();
    std::io::stdin().read_line(&mut buf)?;
    if buf.to_lowercase().trim() == "y" {
        Ok(())
    } else {
        Err(anyhow!("declined"))
    }
}

env_var! {
    struct Vars {
        DatabaseUrl,
        LexicalServiceUrl,
        InternalApiSecretKey,
        OpenaiApiKey,
    }
}

/// The fully-resolved config the backfill needs, regardless of where each value
/// came from (local env vars vs. AWS Secrets Manager).
struct ResolvedConfig {
    database_url: String,
    lexical_service_url: String,
    internal_api_secret_key: String,
    openai_api_key: String,
}

impl ResolvedConfig {
    /// Local config: every value comes straight from the environment / `.env`,
    /// matching the original setup.
    fn local() -> Result<Self> {
        let vars = Vars::new()?;
        Ok(Self {
            // The repo `.env` ships the docker-network DB host (`@postgres`),
            // which isn't resolvable from the host shell, so hardcode the
            // localhost URL for local runs.
            database_url: "postgres://user:password@localhost:5432/macrodb".to_string(),
            // The repo `.env` ships the docker-network lexical host
            // (`http://lexical-service:8096`); use the localhost URL for local runs.
            lexical_service_url: Env::Local.lexical_service_url().to_string(),
            internal_api_secret_key: vars.internal_api_secret_key.as_ref().to_string(),
            openai_api_key: vars.openai_api_key.as_ref().to_string(),
        })
    }

    /// Dev/prod config, resolved from AWS: the lexical URL is hard-coded per
    /// environment, the database URL is read from the `macro-db-<env>` secret via
    /// the `aws` CLI (the same primary-writer secret the deployed services use),
    /// and the OpenAI and internal-auth secrets are fetched from Secrets Manager
    /// with the in-process SDK.
    async fn remote(env: Env) -> Result<Self> {
        // Make sure AWS calls target real AWS rather than a LocalStack override
        // that may be lingering in the env.
        // SAFETY: runs once at startup before any other thread reads the env.
        unsafe { std::env::remove_var("LOCAL_AWS_URL") };

        let database_url = fetch_database_url(env)?;

        let secrets = SecretsManager::new(aws_sdk_secretsmanager::Client::new(
            &macro_aws_config::get_macro_aws_config().await,
        ));
        let openai_api_key = secrets.get_secret_value("openai-key").await?;
        let internal_api_secret_key = secrets
            .get_secret_value(format!(
                "document-storage-service-auth-key-{}",
                env.suffix()
            ))
            .await?;

        Ok(Self {
            database_url,
            lexical_service_url: env.lexical_service_url().to_string(),
            internal_api_secret_key: internal_api_secret_key.as_ref().to_string(),
            openai_api_key: openai_api_key.as_ref().to_string(),
        })
    }

    fn print(&self) {
        println!("________________________________________");
        println!("DATABASE_URL: {}", masked_db_url(&self.database_url));
        println!("LEXICAL_SERVICE_URL: {}", self.lexical_service_url);
        println!("________________________________________");
    }
}

/// Masks the password in a `postgres://user:password@host/...` URL for logging.
fn masked_db_url(url: &str) -> String {
    url.split_once("://")
        .and_then(|(scheme, rest)| {
            let (creds, host) = rest.split_once('@')?;
            let user = creds.split_once(':').map_or(creds, |(user, _)| user);
            Some(format!("{scheme}://{user}:******@{host}"))
        })
        .unwrap_or_else(|| url.to_string())
}

/// Fetches the full `DATABASE_URL` for `env` from AWS Secrets Manager by shelling
/// out to the `aws` CLI. Reads the `macro-db-<env>` secret — the primary-writer
/// connection string the deployed services use — which already contains a
/// ready-to-use `postgres://…` URL, so nothing needs to be assembled.
///
/// The `aws` CLI must be on `PATH` and authenticated (e.g. `aws sso login`).
fn fetch_database_url(env: Env) -> Result<String> {
    let secret_id = format!("macro-db-{}", env.suffix());
    println!("fetching DATABASE_URL from secret {secret_id}");

    let output = std::process::Command::new("aws")
        .args([
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            &secret_id,
            "--query",
            "SecretString",
            "--output",
            "text",
            "--region",
            "us-east-1",
        ])
        .output()
        .with_context(|| format!("failed to run `aws` to read secret {secret_id}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "`aws secretsmanager get-secret-value` failed for {secret_id} \
             (check AWS auth / permissions): {}",
            stderr.trim()
        );
    }

    let database_url = String::from_utf8(output.stdout)
        .context("aws output was not valid UTF-8")?
        .trim()
        .to_string();
    if database_url.is_empty() {
        bail!("secret {secret_id} resolved to an empty value");
    }
    Ok(database_url)
}

struct Context {
    pg: sqlx::PgPool,
    lexical: LexicalClient,
    embedder: TextEmbedding3Small,
    vector_db: PgTaskVectorDb,
}

impl Context {
    async fn connect(config: ResolvedConfig) -> Result<Self> {
        let pg = sqlx::PgPool::connect(&config.database_url)
            .await
            .map_err(anyhow::Error::from)?;
        let lexical =
            LexicalClient::new(config.internal_api_secret_key, config.lexical_service_url);
        let embedder = TextEmbedding3Small::new(config.openai_api_key);
        let vector_db = PgTaskVectorDb::new(pg.clone());
        Ok(Self {
            pg,
            lexical,
            embedder,
            vector_db,
        })
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Local reads everything from the environment / `.env`; dev and prod hard-code
    // their URLs and pull secrets from AWS Secrets Manager.
    let config = match args.env {
        Env::Local => ResolvedConfig::local()?,
        env => ResolvedConfig::remote(env).await?,
    };
    config.print();
    let context = Context::connect(config).await?;

    if args.clear {
        confirm("Are you sure you want to clear all vectors")?;
        confirm("Are you really sure")?;
        return clear_vectors(&context).await;
    }

    let task_set = fetch_task_set(&context, &args).await?;
    let total = task_set.len();
    println!("found {total} task(s) to embed");
    if args.dry_run {
        return Ok(());
    }

    // Embed and store each task concurrently, capped at `--concurrency`. Each
    // task is independent, so a single failure is recorded and the rest carry
    // on; re-running picks up whatever did not get written. The running
    // "<n>/<total>" reflects completion order, not input order.
    let stats = Stats::default();
    futures::stream::iter(task_set)
        .for_each_concurrent(args.concurrency, |document_id| {
            let context = &context;
            let stats = stats.clone();
            async move {
                match embed_and_store(context, &document_id).await {
                    Ok(()) => {
                        let n = stats.success();
                        println!("{n}/{total} success");
                    }
                    Err(error) => {
                        let n = stats.fail();
                        println!("{n}/{total} failure");
                        println!("{error:#}");
                    }
                }
            }
        })
        .await;

    stats.summary();
    Ok(())
}

/// Returns the document ids of the tasks to embed.
///
/// With `--force` this is every task. Otherwise it's only the tasks that do not
/// yet have any row in `task_duplicate_embedding`, so a re-run picks up where a
/// previous one left off. `--limit` caps the result for smoke tests.
async fn fetch_task_set(ctx: &Context, args: &Args) -> Result<Vec<String>> {
    // LIMIT needs a bind value; map "no cap" to i64::MAX so the same query
    // serves both the capped and uncapped cases. `force` is bound too, so a
    // single query covers both modes: when true it short-circuits the
    // NOT EXISTS filter and returns every task.
    let limit = args.limit.map_or(i64::MAX, |n| n as i64);

    sqlx::query_scalar!(
        r#"
        SELECT dst.document_id
        FROM document_sub_type dst
        JOIN "Document" d ON d.id = dst.document_id
        WHERE dst.sub_type = 'task'
          AND d."deletedAt" IS NULL
          AND (
              $1
              OR NOT EXISTS (
                  SELECT 1
                  FROM task_duplicate_embedding tde
                  WHERE tde.document_id = dst.document_id
              )
          )
        LIMIT $2
        "#,
        args.force,
        limit
    )
    .fetch_all(&ctx.pg)
    .await
    .map_err(anyhow::Error::from)
}

/// Embeds a single task and upserts its field embeddings into the vector db.
///
/// Builds the embeddable [`Task`], runs it through the OpenAI embedder, and
/// hands the resulting per-field embeddings to the [`PgTaskVectorDb`] vector
/// store — the same insert path the live duplicate-detection service uses. A
/// task with no embeddable text (empty title and body) is a no-op.
async fn embed_and_store(ctx: &Context, document_id: &str) -> Result<()> {
    let task = fetch_md_task(ctx, document_id).await?;
    let embeddings = ctx.embedder.embed(&task).await?;
    if embeddings.is_empty() {
        return Ok(());
    }
    ctx.vector_db
        .upsert_embeddings(document_id.to_string(), embeddings)
        .await?;
    Ok(())
}

/// Builds the embeddable [`Task`] for a single document: its `Document.name`
/// becomes the title and the lexical service's rendered markdown becomes the
/// body. Map this over a task set to get the entities to embed.
async fn fetch_md_task(ctx: &Context, document_id: &str) -> Result<Task<'static>> {
    let title = sqlx::query_scalar!(r#"SELECT name FROM "Document" WHERE id = $1"#, document_id)
        .fetch_one(&ctx.pg)
        .await
        .map_err(anyhow::Error::from)?;

    let body = ctx.lexical.get_markdown(document_id).await?;

    Ok(Task {
        title: Cow::Owned(title),
        body: Cow::Owned(body),
    })
}

async fn clear_vectors(ctx: &Context) -> Result<()> {
    sqlx::query!("TRUNCATE TABLE task_duplicate_embedding")
        .execute(&ctx.pg)
        .await
        .map_err(anyhow::Error::from)?;
    Ok(())
}
