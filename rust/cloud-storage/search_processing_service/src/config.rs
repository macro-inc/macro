use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use macro_service_urls::LexicalServiceUrl;
use secretsmanager_client::LocalOrRemoteSecret;

env_vars! {
    pub struct DatabaseUrl;
    pub struct SearchEventQueue;
    pub struct OpensearchUrl;
    pub struct OpensearchUsername;
    pub struct OpensearchPassword;
    pub struct DocumentStorageBucket;
    pub struct BackfillJobsTable;
}

maybe_env_vars! {
    pub struct BackfillCallsPageSize;
    pub struct BackfillChatsPageSize;
    pub struct BackfillChannelsPageSize;
    pub struct BackfillDocumentsPageSize;
    pub struct BackfillEmailsPageSize;
    pub struct BackfillJobTtlSeconds;
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
const DEFAULT_BACKFILL_JOB_TTL_SECONDS: u64 = 24 * 60 * 60;

fn parse_page_size(name: &str, raw_value: Option<&str>, default: usize) -> anyhow::Result<usize> {
    let page_size = raw_value
        .map(|raw| {
            raw.parse::<usize>()
                .with_context(|| format!("{name} must be a positive integer"))
        })
        .transpose()?
        .unwrap_or(default);

    if page_size == 0 {
        anyhow::bail!("{name} must be > 0");
    }

    Ok(page_size)
}

fn parse_u64(name: &str, raw_value: Option<&str>, default: u64) -> anyhow::Result<u64> {
    raw_value
        .map(|raw| {
            raw.parse::<u64>()
                .with_context(|| format!("{name} must be a positive integer"))
        })
        .transpose()
        .map(|value| value.unwrap_or(default))
}

/// The configuration parameters for the application.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    /// For deployed applications, this is a secret stored in AWS Secrets Manager.
    pub database_url: LocalOrRemoteSecret<DatabaseUrl>,

    /// Optional connection URL (or SM secret id when `environment != Local`)
    /// for the macrodb read-replica. When present, backfill reads run against
    /// the replica so they do not contend with writes on the primary; queue
    /// workers always read from the primary because replica lag would cause
    /// them to miss rows they are meant to index. When absent, backfills fall
    /// back to the primary.
    pub database_url_readonly: Option<String>,

    /// The port to listen for HTTP requests on.
    #[macro_config_default(8080)]
    pub port: usize,

    /// The search text extractor queue
    pub search_event_queue: SearchEventQueue,
    /// The queue max messages per poll
    #[macro_config_default(10)]
    pub queue_max_messages: i32,
    /// The queue wait time seconds
    #[macro_config_default(20)]
    pub queue_wait_time_seconds: i32,

    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,

    /// The URL for the Opensearch instance
    pub opensearch_url: OpensearchUrl,
    /// The username for the Opensearch instance
    pub opensearch_username: OpensearchUsername,
    /// The password for the Opensearch instance
    pub opensearch_password: LocalOrRemoteSecret<OpensearchPassword>,

    /// The bucket where documents are stored
    pub document_storage_bucket: DocumentStorageBucket,

    /// The number of workers to spawn
    #[macro_config_default(10)]
    pub worker_count: u8,

    /// The URL for the Lexical service
    #[macro_config_default(LexicalServiceUrl::unwrap_new().to_string())]
    pub lexical_service_url: String,

    /// DB page size used when backfilling call records.
    pub backfill_calls_page_size: BackfillCallsPageSize,
    /// DB page size used when backfilling chats.
    pub backfill_chats_page_size: BackfillChatsPageSize,
    /// DB page size used when backfilling channels.
    pub backfill_channels_page_size: BackfillChannelsPageSize,
    /// DB page size used when backfilling documents.
    pub backfill_documents_page_size: BackfillDocumentsPageSize,
    /// DB page size used when backfilling emails.
    pub backfill_emails_page_size: BackfillEmailsPageSize,

    /// DynamoDB table name backing the backfill job registry. Items carry an
    /// `expires_at` epoch attribute that DynamoDB's TTL sweeps in the
    /// background, so completed jobs vanish on their own.
    pub backfill_jobs_table: BackfillJobsTable,

    /// TTL applied to the `expires_at` attribute on each job record. Acts as
    /// the GC mechanism — DynamoDB removes items shortly after this elapses.
    pub backfill_job_ttl_seconds: BackfillJobTtlSeconds,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>().context("failed to load config")
    }

    pub fn backfill_page_sizes(&self) -> anyhow::Result<BackfillPageSizes> {
        Ok(BackfillPageSizes {
            calls: parse_page_size(
                "BACKFILL_CALLS_PAGE_SIZE",
                self.backfill_calls_page_size.value(),
                DEFAULT_CALLS_PAGE,
            )?,
            chats: parse_page_size(
                "BACKFILL_CHATS_PAGE_SIZE",
                self.backfill_chats_page_size.value(),
                DEFAULT_CHATS_PAGE,
            )?,
            channels: parse_page_size(
                "BACKFILL_CHANNELS_PAGE_SIZE",
                self.backfill_channels_page_size.value(),
                DEFAULT_CHANNELS_PAGE,
            )?,
            documents: parse_page_size(
                "BACKFILL_DOCUMENTS_PAGE_SIZE",
                self.backfill_documents_page_size.value(),
                DEFAULT_DOCUMENTS_PAGE,
            )?,
            emails: parse_page_size(
                "BACKFILL_EMAILS_PAGE_SIZE",
                self.backfill_emails_page_size.value(),
                DEFAULT_EMAILS_PAGE,
            )?,
        })
    }

    pub fn backfill_job_ttl_seconds(&self) -> anyhow::Result<u64> {
        parse_u64(
            "BACKFILL_JOB_TTL_SECONDS",
            self.backfill_job_ttl_seconds.value(),
            DEFAULT_BACKFILL_JOB_TTL_SECONDS,
        )
    }
}
