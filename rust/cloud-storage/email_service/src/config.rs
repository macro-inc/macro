use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_var;
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

impl Config {
    pub fn from_env(
        email_service_cloudfront_signer_private_key: LocalOrRemoteSecret<
            EmailServiceCloudfrontSignerPrivateKey,
        >,
    ) -> anyhow::Result<Self> {
        let database_url =
            std::env::var("MACRO_DB_URL").context("MACRO_DB_URL must be provided")?;

        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("should be valid port number")?;

        let redis_uri = std::env::var("REDIS_URI").context("REDIS_URI must be provided")?;

        let link_manager_queue =
            std::env::var("LINK_MANAGER_QUEUE").context("LINK_MANAGER_QUEUE must be provided")?;

        let email_scheduled_queue = std::env::var("EMAIL_SCHEDULED_QUEUE")
            .context("EMAIL_SCHEDULED_QUEUE must be provided")?;

        let gmail_inbox_sync_queue = std::env::var("GMAIL_INBOX_SYNC_QUEUE")
            .context("GMAIL_INBOX_SYNC_QUEUE must be provided")?;

        let gmail_inbox_sync_retry_queue = std::env::var("GMAIL_INBOX_SYNC_RETRY_QUEUE")
            .context("GMAIL_INBOX_SYNC_RETRY_QUEUE must be provided")?;

        let gmail_ops_queue =
            std::env::var("GMAIL_OPS_QUEUE").context("GMAIL_OPS_QUEUE must be provided")?;

        let gmail_ops_retry_queue = std::env::var("GMAIL_OPS_RETRY_QUEUE")
            .context("GMAIL_OPS_RETRY_QUEUE must be provided")?;

        let search_event_queue =
            std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

        let gmail_gcp_queue =
            std::env::var("GMAIL_GCP_QUEUE").context("GMAIL_GCP_QUEUE must be provided")?;

        let notification_queue =
            std::env::var("NOTIFICATION_QUEUE").context("NOTIFICATION_QUEUE must be provided")?;

        let backfill_queue =
            std::env::var("BACKFILL_QUEUE").context("BACKFILL_QUEUE must be provided")?;

        let contacts_queue =
            std::env::var("CONTACTS_QUEUE").context("CONTACTS_QUEUE must be provided")?;

        let sfs_uploader_queue =
            std::env::var("SFS_UPLOADER_QUEUE").context("SFS_UPLOADER_QUEUE must be provided")?;

        let sfs_delete_queue =
            std::env::var("SFS_DELETE_QUEUE").context("SFS_DELETE_QUEUE must be provided")?;

        let attachment_bucket =
            std::env::var("ATTACHMENT_BUCKET").context("ATTACHMENT_BUCKET must be provided")?;

        let sent_undo_delay_secs: u32 = std::env::var("SENT_UNDO_DELAY_SECS")
            .unwrap_or("10".to_string())
            .parse::<u32>()
            .unwrap();

        let notifications_enabled = std::env::var("NOTIFICATIONS_ENABLED")
            .context("NOTIFICATIONS_ENABLED must be provided")?
            .parse::<bool>()
            .context("NOTIFICATIONS_ENABLED must be a boolean value")?;

        let use_apollo_crm_enrichment: bool = std::env::var("USE_APOLLO_CRM_ENRICHMENT")
            .unwrap_or("false".to_string())
            .parse::<bool>()
            .context("USE_APOLLO_CRM_ENRICHMENT must be a boolean value")?;

        let apollo_api_key = std::env::var("APOLLO_API_KEY").unwrap_or_default();

        let queue_max_messages: i32 = std::env::var("QUEUE_MAX_MESSAGES")
            .unwrap_or("10".to_string())
            .parse::<i32>()
            .unwrap();

        let backfill_queue_workers: i32 = std::env::var("BACKFILL_QUEUE_WORKERS")
            .unwrap_or("25".to_string())
            .parse::<i32>()
            .unwrap();

        let backfill_queue_max_messages: i32 = std::env::var("BACKFILL_QUEUE_MAX_MESSAGES")
            .unwrap_or("1".to_string())
            .parse::<i32>()
            .unwrap();

        let inbox_sync_queue_workers: i32 = std::env::var("INBOX_SYNC_QUEUE_WORKERS")
            .unwrap_or("10".to_string())
            .parse::<i32>()
            .unwrap();

        let inbox_sync_queue_max_messages: i32 = std::env::var("INBOX_SYNC_QUEUE_MAX_MESSAGES")
            .unwrap_or("1".to_string())
            .parse::<i32>()
            .unwrap();

        let inbox_sync_retry_queue_workers: i32 = std::env::var("INBOX_SYNC_RETRY_QUEUE_WORKERS")
            .unwrap_or("10".to_string())
            .parse::<i32>()
            .unwrap();

        let inbox_sync_retry_queue_max_messages: i32 =
            std::env::var("INBOX_SYNC_RETRY_QUEUE_MAX_MESSAGES")
                .unwrap_or("1".to_string())
                .parse::<i32>()
                .unwrap();

        let gmail_ops_queue_workers: i32 = std::env::var("GMAIL_OPS_QUEUE_WORKERS")
            .unwrap_or("5".to_string())
            .parse::<i32>()
            .unwrap();

        let gmail_ops_queue_max_messages: i32 = std::env::var("GMAIL_OPS_QUEUE_MAX_MESSAGES")
            .unwrap_or("10".to_string())
            .parse::<i32>()
            .unwrap();

        let gmail_ops_retry_queue_workers: i32 = std::env::var("GMAIL_OPS_RETRY_QUEUE_WORKERS")
            .unwrap_or("2".to_string())
            .parse::<i32>()
            .unwrap();

        let gmail_ops_retry_queue_max_messages: i32 =
            std::env::var("GMAIL_OPS_RETRY_QUEUE_MAX_MESSAGES")
                .unwrap_or("10".to_string())
                .parse::<i32>()
                .unwrap();

        let sfs_uploader_workers: i32 = std::env::var("SFS_UPLOADER_WORKERS")
            .unwrap_or("3".to_string())
            .parse::<i32>()
            .unwrap();

        let redis_rate_limit_reqs: u32 = std::env::var("REDIS_RATE_LIMIT_REQS")
            .unwrap_or("14000".to_string())
            .parse::<u32>()
            .unwrap();

        let redis_rate_limit_reqs_backfill: u32 = std::env::var("REDIS_RATE_LIMIT_REQS_BACKFILL")
            .unwrap_or("13000".to_string())
            .parse::<u32>()
            .unwrap();

        let redis_rate_limit_window_secs: u32 = std::env::var("REDIS_RATE_LIMIT_WINDOW_SECS")
            .unwrap_or("60".to_string())
            .parse::<u32>()
            .unwrap();

        let queue_wait_time_seconds: i32 = std::env::var("QUEUE_WAIT_TIME_SECONDS")
            .unwrap_or("20".to_string())
            .parse::<i32>()
            .unwrap();

        let environment = Environment::new_or_prod();

        let auth_service_url = std::env::var("AUTHENTICATION_SERVICE_URL")
            .context("AUTHENTICATION_SERVICE_URL must be provided")?;

        let auth_service_secret_key = std::env::var("AUTHENTICATION_SERVICE_SECRET_KEY")
            .context("AUTHENTICATION_SERVICE_SECRET_KEY must be provided")?;

        let static_file_service_url = std::env::var("STATIC_FILE_SERVICE_URL")
            .context("STATIC_FILE_SERVICE_URL must be provided")?;

        let connection_gateway_url = std::env::var("CONNECTION_GATEWAY_URL")
            .context("CONNECTION_GATEWAY_URL must be provided")?;

        let document_storage_service_url = std::env::var("DOCUMENT_STORAGE_SERVICE_URL")
            .context("DOCUMENT_STORAGE_SERVICE_URL must be provided")?;

        let email_service_cloudfront_distribution_url =
            std::env::var("EMAIL_SERVICE_CLOUDFRONT_DISTRIBUTION_URL")
                .context("EMAIL_SERVICE_CLOUDFRONT_DISTRIBUTION_URL must be provided")?;

        let email_service_cloudfront_signer_public_key_id =
            std::env::var("EMAIL_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID")
                .context("EMAIL_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID must be provided")?;

        let email_service_presigned_url_ttl_secs: u64 =
            std::env::var("EMAIL_SERVICE_PRESIGNED_URL_TTL_SECS")
                .unwrap_or("3600".to_string())
                .parse::<u64>()
                .unwrap();

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
