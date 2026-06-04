use anyhow::Context;
pub use macro_env::Environment;
use macro_service_urls::LexicalServiceUrl;

/// Per-entity DB page sizes used by the backfill source adapters. Tunable at
/// runtime via the corresponding `BACKFILL_*_PAGE_SIZE` env vars.
#[derive(Debug, Clone, Copy)]
pub struct BackfillPageSizes {
    pub calls: usize,
    pub chats: usize,
    pub channels: usize,
    pub documents: usize,
    pub emails: usize,
}

const DEFAULT_CALLS_PAGE: usize = 2000;
const DEFAULT_CHATS_PAGE: usize = 5000;
const DEFAULT_CHANNELS_PAGE: usize = 5000;
const DEFAULT_DOCUMENTS_PAGE: usize = 1000;
const DEFAULT_EMAILS_PAGE: usize = 1000;

pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    /// For deployed applications, this is a secret stored in AWS Secrets Manager.
    pub database_url: String,

    /// Optional connection URL (or SM secret id when `environment != Local`)
    /// for the macrodb read-replica. When present, backfill reads run against
    /// the replica so they do not contend with writes on the primary; queue
    /// workers always read from the primary because replica lag would cause
    /// them to miss rows they are meant to index. When absent, backfills fall
    /// back to the primary.
    pub database_url_readonly: Option<String>,

    /// The port to listen for HTTP requests on.
    pub port: usize,

    /// The search text extractor queue
    pub search_event_queue: String,
    /// The queue max messages per poll
    pub queue_max_messages: i32,
    /// The queue wait time seconds
    pub queue_wait_time_seconds: i32,

    /// The environment we are in
    pub environment: Environment,

    /// The URL for the Opensearch instance
    pub opensearch_url: String,
    /// The username for the Opensearch instance
    pub opensearch_username: String,
    /// The password for the Opensearch instance
    pub opensearch_password: String,

    /// The bucket where documents are stored
    pub document_storage_bucket: String,

    /// The number of workers to spawn
    pub worker_count: u8,

    /// The URL for the Lexical service
    pub lexical_service_url: String,

    /// Per-entity DB page sizes for backfill adapters.
    pub backfill_page_sizes: BackfillPageSizes,

    /// DynamoDB table name backing the backfill job registry. Items carry an
    /// `expires_at` epoch attribute that DynamoDB's TTL sweeps in the
    /// background, so completed jobs vanish on their own.
    pub backfill_jobs_table: String,

    /// TTL applied to the `expires_at` attribute on each job record. Acts as
    /// the GC mechanism — DynamoDB removes items shortly after this elapses.
    pub backfill_job_ttl_seconds: u64,
}

fn parse_page_size(name: &str, default: usize) -> anyhow::Result<usize> {
    match std::env::var(name) {
        Ok(raw) => raw
            .parse::<usize>()
            .with_context(|| format!("{name} must be a positive integer"))
            .and_then(|n| {
                if n == 0 {
                    anyhow::bail!("{name} must be > 0");
                }
                Ok(n)
            }),
        Err(_) => Ok(default),
    }
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let database_url_readonly = std::env::var("DATABASE_URL_READONLY").ok();

        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("should be valid port number")?;

        let environment = Environment::new_or_prod();

        let search_event_queue =
            std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

        let queue_max_messages: i32 = std::env::var("QUEUE_MAX_MESSAGES")
            .unwrap_or("10".to_string())
            .parse::<i32>()
            .unwrap();

        let queue_wait_time_seconds: i32 = std::env::var("QUEUE_WAIT_TIME_SECONDS")
            .unwrap_or("20".to_string())
            .parse::<i32>()
            .unwrap();

        let opensearch_url =
            std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL must be provided")?;
        let opensearch_username =
            std::env::var("OPENSEARCH_USERNAME").context("OPENSEARCH_USERNAME must be provided")?;
        let opensearch_password =
            std::env::var("OPENSEARCH_PASSWORD").context("OPENSEARCH_PASSWORD must be provided")?;

        let document_storage_bucket = std::env::var("DOCUMENT_STORAGE_BUCKET")
            .context("DOCUMENT_STORAGE_BUCKET must be provided")?;

        let worker_count: u8 = std::env::var("WORKER_COUNT")
            .unwrap_or("10".to_string())
            .parse::<u8>()
            .unwrap();

        let lexical_service_url = LexicalServiceUrl::new()?.to_string();

        let backfill_page_sizes = BackfillPageSizes {
            calls: parse_page_size("BACKFILL_CALLS_PAGE_SIZE", DEFAULT_CALLS_PAGE)?,
            chats: parse_page_size("BACKFILL_CHATS_PAGE_SIZE", DEFAULT_CHATS_PAGE)?,
            channels: parse_page_size("BACKFILL_CHANNELS_PAGE_SIZE", DEFAULT_CHANNELS_PAGE)?,
            documents: parse_page_size("BACKFILL_DOCUMENTS_PAGE_SIZE", DEFAULT_DOCUMENTS_PAGE)?,
            emails: parse_page_size("BACKFILL_EMAILS_PAGE_SIZE", DEFAULT_EMAILS_PAGE)?,
        };

        let backfill_jobs_table =
            std::env::var("BACKFILL_JOBS_TABLE").context("BACKFILL_JOBS_TABLE must be provided")?;
        let backfill_job_ttl_seconds: u64 = std::env::var("BACKFILL_JOB_TTL_SECONDS")
            .unwrap_or_else(|_| (24 * 60 * 60).to_string())
            .parse()
            .context("BACKFILL_JOB_TTL_SECONDS must be a positive integer")?;

        Ok(Config {
            database_url,
            database_url_readonly,
            port,
            search_event_queue,
            queue_max_messages,
            queue_wait_time_seconds,
            environment,
            opensearch_url,
            opensearch_username,
            opensearch_password,
            document_storage_bucket,
            worker_count,
            lexical_service_url,
            backfill_page_sizes,
            backfill_jobs_table,
            backfill_job_ttl_seconds,
        })
    }
}
