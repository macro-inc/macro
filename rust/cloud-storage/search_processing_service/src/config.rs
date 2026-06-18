use std::num::NonZeroUsize;

use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_vars;
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

fn nonzero_page_size(value: usize) -> NonZeroUsize {
    NonZeroUsize::new(value).expect("default backfill page size must be > 0")
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
    #[macro_config_default(nonzero_page_size(DEFAULT_CALLS_PAGE))]
    pub backfill_calls_page_size: NonZeroUsize,
    /// DB page size used when backfilling chats.
    #[macro_config_default(nonzero_page_size(DEFAULT_CHATS_PAGE))]
    pub backfill_chats_page_size: NonZeroUsize,
    /// DB page size used when backfilling channels.
    #[macro_config_default(nonzero_page_size(DEFAULT_CHANNELS_PAGE))]
    pub backfill_channels_page_size: NonZeroUsize,
    /// DB page size used when backfilling documents.
    #[macro_config_default(nonzero_page_size(DEFAULT_DOCUMENTS_PAGE))]
    pub backfill_documents_page_size: NonZeroUsize,
    /// DB page size used when backfilling emails.
    #[macro_config_default(nonzero_page_size(DEFAULT_EMAILS_PAGE))]
    pub backfill_emails_page_size: NonZeroUsize,

    /// DynamoDB table name backing the backfill job registry. Items carry an
    /// `expires_at` epoch attribute that DynamoDB's TTL sweeps in the
    /// background, so completed jobs vanish on their own.
    pub backfill_jobs_table: BackfillJobsTable,

    /// TTL applied to the `expires_at` attribute on each job record. Acts as
    /// the GC mechanism — DynamoDB removes items shortly after this elapses.
    #[macro_config_default(24 * 60 * 60)]
    pub backfill_job_ttl_seconds: u64,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>().context("failed to load config")
    }

    pub fn backfill_page_sizes(&self) -> BackfillPageSizes {
        BackfillPageSizes {
            calls: self.backfill_calls_page_size.get(),
            chats: self.backfill_chats_page_size.get(),
            channels: self.backfill_channels_page_size.get(),
            documents: self.backfill_documents_page_size.get(),
            emails: self.backfill_emails_page_size.get(),
        }
    }
}
