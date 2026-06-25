use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_vars;
use macro_middleware::auth::internal_access::InternalApiKey;
use secretsmanager_client::LocalOrRemoteSecret;

env_vars! {
    pub struct EmailServiceCloudfrontSignerPrivateKey;
    pub struct MacroDbUrl;
    pub struct RedisUri;
    pub struct LinkManagerQueue;
    pub struct EmailScheduledQueue;
    pub struct GmailInboxSyncQueue;
    pub struct GmailInboxSyncRetryQueue;
    pub struct GmailOpsQueue;
    pub struct GmailOpsRetryQueue;
    pub struct SearchEventQueue;
    pub struct GmailGcpQueue;
    pub struct NotificationQueue;
    pub struct BackfillQueue;
    pub struct ContactsQueue;
    pub struct SfsUploaderQueue;
    pub struct SfsDeleteQueue;
    #[derive(Debug)]
    pub struct AttachmentBucket;
    pub struct NotificationsEnabled;
    pub struct AuthenticationServiceSecretKey;
    pub struct EmailServiceCloudfrontDistributionUrl;
    pub struct EmailServiceCloudfrontSignerPublicKeyId;
    pub struct ApolloApiKey;
}

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The connection URL for the macrodb instance this application should use.
    /// For deployed applications, this is a secret stored in AWS Secrets Manager.
    pub macro_db_url: MacroDbUrl,

    /// The port to listen for HTTP requests on.
    #[macro_config_default(8080)]
    pub port: usize,

    /// The Redis URI for the Redis this application should use.
    pub redis_uri: RedisUri,

    /// The SQS queue name that email_refresh_handler publishes messages to for refreshing
    /// inbox sync subscriptions, and we will publish delete link messages to.
    pub link_manager_queue: LinkManagerQueue,

    /// The SQS queue name that email_scheduled_handler publishes messages to for sending
    /// scheduled messages.
    pub email_scheduled_queue: EmailScheduledQueue,

    /// The SQS queue name we process inbox updates from.
    pub gmail_inbox_sync_queue: GmailInboxSyncQueue,

    /// The SQS queue name we process inbox update retries from. Separate from the main queue
    /// to avoid backups for large inbox update operations
    pub gmail_inbox_sync_retry_queue: GmailInboxSyncRetryQueue,

    /// The SQS queue name for async Gmail operations (label changes, block/unblock, etc.)
    pub gmail_ops_queue: GmailOpsQueue,

    /// The SQS queue name for retrying rate-limited Gmail operations
    pub gmail_ops_retry_queue: GmailOpsRetryQueue,

    /// The SQS queue name for search event
    pub search_event_queue: SearchEventQueue,

    /// The GCP queue name that has the subscription that hits our webhook endpoint
    pub gmail_gcp_queue: GmailGcpQueue,

    /// The SQS queue name for notification-service
    pub notification_queue: NotificationQueue,

    /// The SQS queue name for the backfill process
    pub backfill_queue: BackfillQueue,

    /// The SQS queue name for the sfs_uploader process
    pub sfs_uploader_queue: SfsUploaderQueue,

    /// The SQS queue name for the sfs_delete process
    pub sfs_delete_queue: SfsDeleteQueue,

    /// The SQS queue name for contacts service
    pub contacts_queue: ContactsQueue,

    /// The amount of time to delay processing of a sent message (undo send window) - default 10s
    #[macro_config_default(10)]
    pub sent_undo_delay_secs: u32,

    /// The SQS bucket for storing attachments
    pub attachment_bucket: AttachmentBucket,

    /// Notification-service functionality
    #[macro_config_default(true)]
    pub notifications_enabled: bool,

    /// Use Apollo.io for CRM company enrichment. When `false`, fall back
    /// to the unfurl-based resolver.
    #[macro_config_default(false)]
    pub use_apollo_crm_enrichment: bool,

    /// Apollo.io API key for CRM enrichment. Locally this is the key
    /// itself; in deployed envs it's the name of the Secrets Manager
    /// secret holding it (resolved at startup). Empty disables enrichment.
    pub apollo_api_key: LocalOrRemoteSecret<ApolloApiKey>,

    /// The queue max messages per poll
    #[macro_config_default(10)]
    pub queue_max_messages: i32,

    /// The number of workers we spawn for backfill
    #[macro_config_default(25)]
    pub backfill_queue_workers: i32,

    /// The queue max messages per poll for backfill
    #[macro_config_default(1)]
    pub backfill_queue_max_messages: i32,

    /// The number of workers we spawn for gmail inbox sync
    #[macro_config_default(10)]
    pub inbox_sync_queue_workers: i32,

    /// The queue max messages per poll for gmail inbox sync
    #[macro_config_default(1)]
    pub inbox_sync_queue_max_messages: i32,

    /// The number of workers we spawn for gmail retry inbox sync
    #[macro_config_default(10)]
    pub inbox_sync_retry_queue_workers: i32,

    /// The queue max messages per poll for gmail retry inbox sync
    #[macro_config_default(1)]
    pub inbox_sync_retry_queue_max_messages: i32,

    /// The number of workers we spawn for gmail ops
    #[macro_config_default(5)]
    pub gmail_ops_queue_workers: i32,

    /// The queue max messages per poll for gmail ops
    #[macro_config_default(10)]
    pub gmail_ops_queue_max_messages: i32,

    /// The number of workers we spawn for gmail ops retry
    #[macro_config_default(2)]
    pub gmail_ops_retry_queue_workers: i32,

    /// The queue max messages per poll for gmail ops retry
    #[macro_config_default(10)]
    pub gmail_ops_retry_queue_max_messages: i32,

    /// The number of workers we spawn for sfs uploader
    #[macro_config_default(3)]
    pub sfs_uploader_workers: i32,

    /// The number of requests we allow per window for backfilling. Less than redis_rate_limit_reqs
    /// so we have room for normal gmail operations while backfilling is occurring
    #[macro_config_default(13000)]
    pub redis_rate_limit_reqs_backfill: u32,

    /// The number of requests we allow per window.
    #[macro_config_default(14000)]
    pub redis_rate_limit_reqs: u32,

    /// The size of the sliding window we use for rate limit.
    #[macro_config_default(60)]
    pub redis_rate_limit_window_secs: u32,

    /// The queue wait time seconds
    #[macro_config_default(20)]
    pub queue_wait_time_seconds: i32,

    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,

    /// Auth service secret key, used for internal access
    pub authentication_service_secret_key: LocalOrRemoteSecret<AuthenticationServiceSecretKey>,

    // The URL for cloudfront
    pub email_service_cloudfront_distribution_url: EmailServiceCloudfrontDistributionUrl,

    // The secret for the cloudfront private key
    pub email_service_cloudfront_signer_private_key:
        LocalOrRemoteSecret<EmailServiceCloudfrontSignerPrivateKey>,

    // The public key for cloudfront
    pub email_service_cloudfront_signer_public_key_id: EmailServiceCloudfrontSignerPublicKeyId,

    // How long presigned urls should be valid for attachments
    #[macro_config_default(3600)]
    pub email_service_presigned_url_ttl_secs: u64,

    /// The internal api key
    pub internal_api_key: InternalApiKey,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>().context("failed to load config")
    }
}
