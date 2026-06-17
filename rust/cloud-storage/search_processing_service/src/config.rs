use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use macro_service_urls::LexicalServiceUrl;

env_vars! {
    struct DatabaseUrl;
    struct SearchEventQueue;
    struct OpensearchUrl;
    struct OpensearchUsername;
    struct OpensearchPassword;
    struct DocumentStorageBucket;
    struct BackfillJobsTable;
}

maybe_env_vars! {
    struct DatabaseUrlReadonly;
    struct Port;
    struct QueueMaxMessages;
    struct QueueWaitTimeSeconds;
    struct WorkerCount;
    struct BackfillCallsPageSize;
    struct BackfillChatsPageSize;
    struct BackfillChannelsPageSize;
    struct BackfillDocumentsPageSize;
    struct BackfillEmailsPageSize;
    struct BackfillJobTtlSeconds;
}

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

fn parse_page_size(name: &str, raw_value: Option<String>, default: usize) -> anyhow::Result<usize> {
    match raw_value {
        Some(raw) => raw
            .parse::<usize>()
            .with_context(|| format!("{name} must be a positive integer"))
            .and_then(|n| {
                if n == 0 {
                    anyhow::bail!("{name} must be > 0");
                }
                Ok(n)
            }),
        None => Ok(default),
    }
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = DatabaseUrl::new()
            .context("DATABASE_URL must be provided")?
            .to_string();

        let database_url_readonly = DatabaseUrlReadonly::new().map(|url| url.to_string());

        let port = Port::new()
            .map(|port| port.parse::<usize>().context("should be valid port number"))
            .transpose()?
            .unwrap_or(8080);

        let environment = Environment::new_or_prod();

        let search_event_queue = SearchEventQueue::new()
            .context("SEARCH_EVENT_QUEUE must be provided")?
            .to_string();

        let queue_max_messages = QueueMaxMessages::new()
            .map(|queue_max_messages| {
                queue_max_messages
                    .parse::<i32>()
                    .context("QUEUE_MAX_MESSAGES must be a valid i32")
            })
            .transpose()?
            .unwrap_or(10);

        let queue_wait_time_seconds = QueueWaitTimeSeconds::new()
            .map(|queue_wait_time_seconds| {
                queue_wait_time_seconds
                    .parse::<i32>()
                    .context("QUEUE_WAIT_TIME_SECONDS must be a valid i32")
            })
            .transpose()?
            .unwrap_or(20);

        let opensearch_url = OpensearchUrl::new()
            .context("OPENSEARCH_URL must be provided")?
            .to_string();
        let opensearch_username = OpensearchUsername::new()
            .context("OPENSEARCH_USERNAME must be provided")?
            .to_string();
        let opensearch_password = OpensearchPassword::new()
            .context("OPENSEARCH_PASSWORD must be provided")?
            .to_string();

        let document_storage_bucket = DocumentStorageBucket::new()
            .context("DOCUMENT_STORAGE_BUCKET must be provided")?
            .to_string();

        let worker_count = WorkerCount::new()
            .map(|worker_count| {
                worker_count
                    .parse::<u8>()
                    .context("WORKER_COUNT must be a valid u8")
            })
            .transpose()?
            .unwrap_or(10);

        let lexical_service_url = LexicalServiceUrl::new()?.to_string();

        let backfill_page_sizes = BackfillPageSizes {
            calls: parse_page_size(
                "BACKFILL_CALLS_PAGE_SIZE",
                BackfillCallsPageSize::new().map(|value| value.to_string()),
                DEFAULT_CALLS_PAGE,
            )?,
            chats: parse_page_size(
                "BACKFILL_CHATS_PAGE_SIZE",
                BackfillChatsPageSize::new().map(|value| value.to_string()),
                DEFAULT_CHATS_PAGE,
            )?,
            channels: parse_page_size(
                "BACKFILL_CHANNELS_PAGE_SIZE",
                BackfillChannelsPageSize::new().map(|value| value.to_string()),
                DEFAULT_CHANNELS_PAGE,
            )?,
            documents: parse_page_size(
                "BACKFILL_DOCUMENTS_PAGE_SIZE",
                BackfillDocumentsPageSize::new().map(|value| value.to_string()),
                DEFAULT_DOCUMENTS_PAGE,
            )?,
            emails: parse_page_size(
                "BACKFILL_EMAILS_PAGE_SIZE",
                BackfillEmailsPageSize::new().map(|value| value.to_string()),
                DEFAULT_EMAILS_PAGE,
            )?,
        };

        let backfill_jobs_table = BackfillJobsTable::new()
            .context("BACKFILL_JOBS_TABLE must be provided")?
            .to_string();
        let backfill_job_ttl_seconds = BackfillJobTtlSeconds::new()
            .map(|backfill_job_ttl_seconds| {
                backfill_job_ttl_seconds
                    .parse::<u64>()
                    .context("BACKFILL_JOB_TTL_SECONDS must be a positive integer")
            })
            .transpose()?
            .unwrap_or(24 * 60 * 60);

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
