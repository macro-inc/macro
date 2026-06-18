use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::{env_var, env_vars, maybe_env_vars};
use macro_service_urls::{ConnectionGatewayUrl, DocumentStorageServiceUrl, StaticFileServiceUrl};
use secretsmanager_client::LocalOrRemoteSecret;

pub struct Config {
    /// The connection URL for the macrodb instance this application should use.
    /// For deployed applications, this is a secret stored in AWS Secrets Manager.
    pub macro_db_url: String,

    /// The port to listen for HTTP requests on.
    pub port: usize,

    /// The Redis URI for the Redis this application should use.
    pub redis_uri: String,

    /// The SQS queue name that email_refresh_handler publishes messages to for refreshing
    /// inbox sync subscriptions, and we will publish delete link messages to.
    pub link_manager_queue: String,

    /// The SQS queue name that email_scheduled_handler publishes messages to for sending
    /// scheduled messages.
    pub email_scheduled_queue: String,

    /// The SQS queue name we process inbox updates from.
    pub gmail_inbox_sync_queue: String,

    /// The SQS queue name we process inbox update retries from. Separate from the main queue
    /// to avoid backups for large inbox update operations
    pub gmail_inbox_sync_retry_queue: String,

    /// The SQS queue name for async Gmail operations (label changes, block/unblock, etc.)
    pub gmail_ops_queue: String,

    /// The SQS queue name for retrying rate-limited Gmail operations
    pub gmail_ops_retry_queue: String,

    /// The SQS queue name for search event
    pub search_event_queue: String,

    /// The GCP queue name that has the subscription that hits our webhook endpoint
    pub gmail_gcp_queue: String,

    /// The SQS queue name for notification-service
    pub notification_queue: String,

    /// The SQS queue name for the backfill process
    pub backfill_queue: String,

    /// The SQS queue name for the sfs_uploader process
    pub sfs_uploader_queue: String,

    /// The SQS queue name for the sfs_delete process
    pub sfs_delete_queue: String,

    /// The SQS queue name for contacts service
    pub contacts_queue: String,

    /// The amount of time to delay processing of a sent message (undo send window) - default 10s
    pub sent_undo_delay_secs: u32,

    /// The SQS bucket for storing attachments
    pub attachment_bucket: String,

    /// Notification-service functionality
    pub notifications_enabled: bool,

    /// Use Apollo.io for CRM company enrichment. When `false`, fall back
    /// to the unfurl-based resolver.
    pub use_apollo_crm_enrichment: bool,

    /// Apollo.io API key for CRM enrichment. Locally this is the key
    /// itself; in deployed envs it's the name of the Secrets Manager
    /// secret holding it (resolved at startup). Empty disables enrichment.
    pub apollo_api_key: String,

    /// The queue max messages per poll
    pub queue_max_messages: i32,

    /// The number of workers we spawn for backfill
    pub backfill_queue_workers: i32,

    /// The queue max messages per poll for backfill
    pub backfill_queue_max_messages: i32,

    /// The number of workers we spawn for gmail inbox sync
    pub inbox_sync_queue_workers: i32,

    /// The queue max messages per poll for gmail inbox sync
    pub inbox_sync_queue_max_messages: i32,

    /// The number of workers we spawn for gmail retry inbox sync
    pub inbox_sync_retry_queue_workers: i32,

    /// The queue max messages per poll for gmail retry inbox sync
    pub inbox_sync_retry_queue_max_messages: i32,

    /// The number of workers we spawn for gmail ops
    pub gmail_ops_queue_workers: i32,

    /// The queue max messages per poll for gmail ops
    pub gmail_ops_queue_max_messages: i32,

    /// The number of workers we spawn for gmail ops retry
    pub gmail_ops_retry_queue_workers: i32,

    /// The queue max messages per poll for gmail ops retry
    pub gmail_ops_retry_queue_max_messages: i32,

    /// The number of workers we spawn for sfs uploader
    pub sfs_uploader_workers: i32,

    /// The number of requests we allow per window for backfilling. Less than redis_rate_limit_reqs
    /// so we have room for normal gmail operations while backfilling is occurring
    pub redis_rate_limit_reqs_backfill: u32,

    /// The number of requests we allow per window.
    pub redis_rate_limit_reqs: u32,

    /// The size of the sliding window we use for rate limit.
    pub redis_rate_limit_window_secs: u32,

    /// The queue wait time seconds
    pub queue_wait_time_seconds: i32,

    /// The environment we are in
    pub environment: Environment,

    /// Auth service secret key, used for internal access
    pub auth_service_secret_key: String,

    /// URL for auth service
    pub auth_service_url: String,

    /// The static file service url
    pub static_file_service_url: String,

    // The DSS url
    pub document_storage_service_url: String,

    /// The connection gateway client url
    pub connection_gateway_url: String,

    // The URL for cloudfront
    pub email_service_cloudfront_distribution_url: String,

    // The secret for the cloudfront private key
    pub email_service_cloudfront_signer_private_key:
        LocalOrRemoteSecret<EmailServiceCloudfrontSignerPrivateKey>,

    // The public key for cloudfront
    pub email_service_cloudfront_signer_public_key_id: String,

    // How long presigned urls should be valid for attachments
    pub email_service_presigned_url_ttl_secs: u64,
}

env_var! { pub struct EmailServiceCloudfrontSignerPrivateKey; }

env_vars! {
    struct MacroDbUrl;
    struct RedisUri;
    struct LinkManagerQueue;
    struct EmailScheduledQueue;
    struct GmailInboxSyncQueue;
    struct GmailInboxSyncRetryQueue;
    struct GmailOpsQueue;
    struct GmailOpsRetryQueue;
    struct SearchEventQueue;
    struct GmailGcpQueue;
    struct NotificationQueue;
    struct BackfillQueue;
    struct ContactsQueue;
    struct SfsUploaderQueue;
    struct SfsDeleteQueue;
    struct AttachmentBucket;
    struct NotificationsEnabled;
    struct AuthenticationServiceUrl;
    struct AuthenticationServiceSecretKey;
    struct EmailServiceCloudfrontDistributionUrl;
    struct EmailServiceCloudfrontSignerPublicKeyId;
}

maybe_env_vars! {
    struct Port;
    struct SentUndoDelaySecs;
    struct UseApolloCrmEnrichment;
    struct ApolloApiKey;
    struct QueueMaxMessages;
    struct BackfillQueueWorkers;
    struct BackfillQueueMaxMessages;
    struct InboxSyncQueueWorkers;
    struct InboxSyncQueueMaxMessages;
    struct InboxSyncRetryQueueWorkers;
    struct InboxSyncRetryQueueMaxMessages;
    struct GmailOpsQueueWorkers;
    struct GmailOpsQueueMaxMessages;
    struct GmailOpsRetryQueueWorkers;
    struct GmailOpsRetryQueueMaxMessages;
    struct SfsUploaderWorkers;
    struct RedisRateLimitReqs;
    struct RedisRateLimitReqsBackfill;
    struct RedisRateLimitWindowSecs;
    struct QueueWaitTimeSeconds;
    struct EmailServicePresignedUrlTtlSecs;
}

fn parse_optional_env<T, V>(
    value: Option<V>,
    default: T,
    context: &'static str,
) -> anyhow::Result<T>
where
    T: std::str::FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
    V: AsRef<str>,
{
    value
        .map(|value| value.as_ref().parse::<T>().context(context))
        .transpose()
        .map(|value| value.unwrap_or(default))
}

impl Config {
    pub fn from_env(
        email_service_cloudfront_signer_private_key: LocalOrRemoteSecret<
            EmailServiceCloudfrontSignerPrivateKey,
        >,
    ) -> anyhow::Result<Self> {
        let database_url = MacroDbUrl::new()
            .context("MACRO_DB_URL must be provided")?
            .to_string();

        let port = parse_optional_env(Port::new(), 8080usize, "should be valid port number")?;

        let redis_uri = RedisUri::new()
            .context("REDIS_URI must be provided")?
            .to_string();

        let link_manager_queue = LinkManagerQueue::new()
            .context("LINK_MANAGER_QUEUE must be provided")?
            .to_string();

        let email_scheduled_queue = EmailScheduledQueue::new()
            .context("EMAIL_SCHEDULED_QUEUE must be provided")?
            .to_string();

        let gmail_inbox_sync_queue = GmailInboxSyncQueue::new()
            .context("GMAIL_INBOX_SYNC_QUEUE must be provided")?
            .to_string();

        let gmail_inbox_sync_retry_queue = GmailInboxSyncRetryQueue::new()
            .context("GMAIL_INBOX_SYNC_RETRY_QUEUE must be provided")?
            .to_string();

        let gmail_ops_queue = GmailOpsQueue::new()
            .context("GMAIL_OPS_QUEUE must be provided")?
            .to_string();

        let gmail_ops_retry_queue = GmailOpsRetryQueue::new()
            .context("GMAIL_OPS_RETRY_QUEUE must be provided")?
            .to_string();

        let search_event_queue = SearchEventQueue::new()
            .context("SEARCH_EVENT_QUEUE must be provided")?
            .to_string();

        let gmail_gcp_queue = GmailGcpQueue::new()
            .context("GMAIL_GCP_QUEUE must be provided")?
            .to_string();

        let notification_queue = NotificationQueue::new()
            .context("NOTIFICATION_QUEUE must be provided")?
            .to_string();

        let backfill_queue = BackfillQueue::new()
            .context("BACKFILL_QUEUE must be provided")?
            .to_string();

        let contacts_queue = ContactsQueue::new()
            .context("CONTACTS_QUEUE must be provided")?
            .to_string();

        let sfs_uploader_queue = SfsUploaderQueue::new()
            .context("SFS_UPLOADER_QUEUE must be provided")?
            .to_string();

        let sfs_delete_queue = SfsDeleteQueue::new()
            .context("SFS_DELETE_QUEUE must be provided")?
            .to_string();

        let attachment_bucket = AttachmentBucket::new()
            .context("ATTACHMENT_BUCKET must be provided")?
            .to_string();

        let sent_undo_delay_secs = parse_optional_env(
            SentUndoDelaySecs::new(),
            10u32,
            "SENT_UNDO_DELAY_SECS must be a valid u32",
        )?;

        let notifications_enabled = NotificationsEnabled::new()
            .context("NOTIFICATIONS_ENABLED must be provided")?
            .parse::<bool>()
            .context("NOTIFICATIONS_ENABLED must be a boolean value")?;

        let use_apollo_crm_enrichment = parse_optional_env(
            UseApolloCrmEnrichment::new(),
            false,
            "USE_APOLLO_CRM_ENRICHMENT must be a boolean value",
        )?;

        let apollo_api_key = ApolloApiKey::new()
            .map(|api_key| api_key.to_string())
            .unwrap_or_default();

        let queue_max_messages = parse_optional_env(
            QueueMaxMessages::new(),
            10i32,
            "QUEUE_MAX_MESSAGES must be a valid i32",
        )?;

        let backfill_queue_workers = parse_optional_env(
            BackfillQueueWorkers::new(),
            25i32,
            "BACKFILL_QUEUE_WORKERS must be a valid i32",
        )?;

        let backfill_queue_max_messages = parse_optional_env(
            BackfillQueueMaxMessages::new(),
            1i32,
            "BACKFILL_QUEUE_MAX_MESSAGES must be a valid i32",
        )?;

        let inbox_sync_queue_workers = parse_optional_env(
            InboxSyncQueueWorkers::new(),
            10i32,
            "INBOX_SYNC_QUEUE_WORKERS must be a valid i32",
        )?;

        let inbox_sync_queue_max_messages = parse_optional_env(
            InboxSyncQueueMaxMessages::new(),
            1i32,
            "INBOX_SYNC_QUEUE_MAX_MESSAGES must be a valid i32",
        )?;

        let inbox_sync_retry_queue_workers = parse_optional_env(
            InboxSyncRetryQueueWorkers::new(),
            10i32,
            "INBOX_SYNC_RETRY_QUEUE_WORKERS must be a valid i32",
        )?;

        let inbox_sync_retry_queue_max_messages = parse_optional_env(
            InboxSyncRetryQueueMaxMessages::new(),
            1i32,
            "INBOX_SYNC_RETRY_QUEUE_MAX_MESSAGES must be a valid i32",
        )?;

        let gmail_ops_queue_workers = parse_optional_env(
            GmailOpsQueueWorkers::new(),
            5i32,
            "GMAIL_OPS_QUEUE_WORKERS must be a valid i32",
        )?;

        let gmail_ops_queue_max_messages = parse_optional_env(
            GmailOpsQueueMaxMessages::new(),
            10i32,
            "GMAIL_OPS_QUEUE_MAX_MESSAGES must be a valid i32",
        )?;

        let gmail_ops_retry_queue_workers = parse_optional_env(
            GmailOpsRetryQueueWorkers::new(),
            2i32,
            "GMAIL_OPS_RETRY_QUEUE_WORKERS must be a valid i32",
        )?;

        let gmail_ops_retry_queue_max_messages = parse_optional_env(
            GmailOpsRetryQueueMaxMessages::new(),
            10i32,
            "GMAIL_OPS_RETRY_QUEUE_MAX_MESSAGES must be a valid i32",
        )?;

        let sfs_uploader_workers = parse_optional_env(
            SfsUploaderWorkers::new(),
            3i32,
            "SFS_UPLOADER_WORKERS must be a valid i32",
        )?;

        let redis_rate_limit_reqs = parse_optional_env(
            RedisRateLimitReqs::new(),
            14000u32,
            "REDIS_RATE_LIMIT_REQS must be a valid u32",
        )?;

        let redis_rate_limit_reqs_backfill = parse_optional_env(
            RedisRateLimitReqsBackfill::new(),
            13000u32,
            "REDIS_RATE_LIMIT_REQS_BACKFILL must be a valid u32",
        )?;

        let redis_rate_limit_window_secs = parse_optional_env(
            RedisRateLimitWindowSecs::new(),
            60u32,
            "REDIS_RATE_LIMIT_WINDOW_SECS must be a valid u32",
        )?;

        let queue_wait_time_seconds = parse_optional_env(
            QueueWaitTimeSeconds::new(),
            20i32,
            "QUEUE_WAIT_TIME_SECONDS must be a valid i32",
        )?;

        let environment = Environment::new_or_prod();

        let auth_service_url = AuthenticationServiceUrl::new()
            .context("AUTHENTICATION_SERVICE_URL must be provided")?
            .to_string();

        let auth_service_secret_key = AuthenticationServiceSecretKey::new()
            .context("AUTHENTICATION_SERVICE_SECRET_KEY must be provided")?
            .to_string();

        let static_file_service_url = StaticFileServiceUrl::new()?.to_string();

        let connection_gateway_url = ConnectionGatewayUrl::new()?.to_string();

        let document_storage_service_url = DocumentStorageServiceUrl::new()?.to_string();

        let email_service_cloudfront_distribution_url =
            EmailServiceCloudfrontDistributionUrl::new()
                .context("EMAIL_SERVICE_CLOUDFRONT_DISTRIBUTION_URL must be provided")?
                .to_string();

        let email_service_cloudfront_signer_public_key_id =
            EmailServiceCloudfrontSignerPublicKeyId::new()
                .context("EMAIL_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID must be provided")?
                .to_string();

        let email_service_presigned_url_ttl_secs = parse_optional_env(
            EmailServicePresignedUrlTtlSecs::new(),
            3600u64,
            "EMAIL_SERVICE_PRESIGNED_URL_TTL_SECS must be a valid u64",
        )?;

        Ok(Config {
            macro_db_url: database_url,
            port,
            redis_uri,
            link_manager_queue,
            email_scheduled_queue,
            gmail_inbox_sync_queue,
            gmail_inbox_sync_retry_queue,
            gmail_ops_queue,
            gmail_ops_retry_queue,
            search_event_queue,
            gmail_gcp_queue,
            notification_queue,
            backfill_queue,
            sfs_uploader_queue,
            sfs_delete_queue,
            contacts_queue,
            attachment_bucket,
            sent_undo_delay_secs,
            notifications_enabled,
            use_apollo_crm_enrichment,
            apollo_api_key,
            queue_max_messages,
            queue_wait_time_seconds,
            backfill_queue_workers,
            backfill_queue_max_messages,
            inbox_sync_queue_workers,
            inbox_sync_queue_max_messages,
            inbox_sync_retry_queue_workers,
            inbox_sync_retry_queue_max_messages,
            gmail_ops_queue_workers,
            gmail_ops_queue_max_messages,
            gmail_ops_retry_queue_workers,
            gmail_ops_retry_queue_max_messages,
            sfs_uploader_workers,
            redis_rate_limit_reqs,
            redis_rate_limit_reqs_backfill,
            redis_rate_limit_window_secs,
            environment,
            auth_service_secret_key,
            auth_service_url,
            static_file_service_url,
            document_storage_service_url,
            connection_gateway_url,
            email_service_cloudfront_distribution_url,
            email_service_cloudfront_signer_public_key_id,
            email_service_cloudfront_signer_private_key,
            email_service_presigned_url_ttl_secs,
        })
    }
}
