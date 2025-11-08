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
    /// inbox sync subscriptions.
    pub email_refresh_queue: String,

    /// The SQS queue name that email_scheduled_handler publishes messages to for sending
    /// scheduled messages.
    pub email_scheduled_queue: String,

    /// The SQS queue name we process history updates from.
    pub gmail_webhook_queue: String,

    /// The SQS queue name for search event
    pub search_event_queue: String,

    /// Insight context queue
    pub insight_context_queue: String,

    /// The GCP queue name that has the subscription that hits our webhook endpoint
    pub gmail_gcp_queue: String,

    /// The SQS queue name for notification-service
    pub notification_queue: String,

    /// The SQS queue name for the backfill process
    pub backfill_queue: String,

    /// The SQS queue name for the sfs_uploader process
    pub sfs_uploader_queue: String,

    /// The SQS bucket for storing attachments
    pub attachment_bucket: String,

    /// Notification-service functionality
    pub notifications_enabled: bool,

    /// The queue max messages per poll
    pub queue_max_messages: i32,

    /// The number of workers we spawn for backfill
    pub backfill_queue_workers: i32,

    /// The queue max messages per poll for backfill
    pub backfill_queue_max_messages: i32,

    /// The number of workers we spawn for gmail webhook
    pub webhook_queue_workers: i32,

    /// The queue max messages per poll for gmail webhook
    pub webhook_queue_max_messages: i32,

    /// The number of workers we spawn for sfs uploader
    pub sfs_uploader_workers: i32,

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
    pub cloudfront_distribution_url: String,

    // The secret for the cloudfront private key
    pub cloudfront_signer_private_key: LocalOrRemoteSecret<CloudfrontSignerPrivateKey>,

    // The public key for cloudfront
    pub cloudfront_signer_public_key_id: String,

    // How long presigned urls should be valid for attachments
    pub presigned_url_ttl_secs: u64,
}

env_var! { pub struct CloudfrontSignerPrivateKey; }

impl Config {
    pub fn from_env(
        cloudfront_signer_private_key: LocalOrRemoteSecret<CloudfrontSignerPrivateKey>,
    ) -> anyhow::Result<Self> {
        let database_url =
            std::env::var("MACRO_DB_URL").context("MACRO_DB_URL must be provided")?;

        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("should be valid port number")?;

        let redis_uri = std::env::var("REDIS_URI").context("REDIS_URI must be provided")?;

        let email_refresh_queue =
            std::env::var("EMAIL_REFRESH_QUEUE").context("EMAIL_REFRESH_QUEUE must be provided")?;

        let email_scheduled_queue = std::env::var("EMAIL_SCHEDULED_QUEUE")
            .context("EMAIL_SCHEDULED_QUEUE must be provided")?;

        let gmail_webhook_queue =
            std::env::var("GMAIL_WEBHOOK_QUEUE").context("GMAIL_WEBHOOK_QUEUE must be provided")?;

        let search_event_queue =
            std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

        let insight_context_queue = std::env::var("INSIGHT_CONTEXT_QUEUE")
            .context("INSIGHT_CONTEXT_QUEUE must be provided")?;

        let gmail_gcp_queue =
            std::env::var("GMAIL_GCP_QUEUE").context("GMAIL_GCP_QUEUE must be provided")?;

        let notification_queue =
            std::env::var("NOTIFICATION_QUEUE").context("NOTIFICATION_QUEUE must be provided")?;

        let backfill_queue =
            std::env::var("BACKFILL_QUEUE").context("BACKFILL_QUEUE must be provided")?;

        let sfs_uploader_queue =
            std::env::var("SFS_UPLOADER_QUEUE").context("SFS_UPLOADER_QUEUE must be provided")?;

        let attachment_bucket =
            std::env::var("ATTACHMENT_BUCKET").context("ATTACHMENT_BUCKET must be provided")?;

        let notifications_enabled = std::env::var("NOTIFICATIONS_ENABLED")
            .context("NOTIFICATIONS_ENABLED must be provided")?
            .parse::<bool>()
            .context("NOTIFICATIONS_ENABLED must be a boolean value")?;

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

        let webhook_queue_workers: i32 = std::env::var("WEBHOOK_QUEUE_WORKERS")
            .unwrap_or("10".to_string())
            .parse::<i32>()
            .unwrap();

        let webhook_queue_max_messages: i32 = std::env::var("WEBHOOK_QUEUE_MAX_MESSAGES")
            .unwrap_or("1".to_string())
            .parse::<i32>()
            .unwrap();

        let sfs_uploader_workers: i32 = std::env::var("SFS_UPLOADER_WORKERS")
            .unwrap_or("3".to_string())
            .parse::<i32>()
            .unwrap();

        let redis_rate_limit_reqs: u32 = std::env::var("REDIS_RATE_LIMIT_REQS")
            .unwrap_or("1500".to_string())
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

        let cloudfront_distribution_url = std::env::var("CLOUDFRONT_DISTRIBUTION_URL")
            .context("CLOUDFRONT_DISTRIBUTION_URL must be provided")?;

        let cloudfront_signer_public_key_id = std::env::var("CLOUDFRONT_SIGNER_PUBLIC_KEY_ID")
            .context("CLOUDFRONT_SIGNER_PUBLIC_KEY_ID must be provided")?;

        let presigned_url_ttl_secs: u64 = std::env::var("PRESIGNED_URL_TTL_SECS")
            .unwrap_or("3600".to_string())
            .parse::<u64>()
            .unwrap();

        Ok(Config {
            macro_db_url: database_url,
            port,
            redis_uri,
            email_refresh_queue,
            email_scheduled_queue,
            gmail_webhook_queue,
            search_event_queue,
            insight_context_queue,
            gmail_gcp_queue,
            notification_queue,
            backfill_queue,
            sfs_uploader_queue,
            attachment_bucket,
            notifications_enabled,
            queue_max_messages,
            queue_wait_time_seconds,
            backfill_queue_workers,
            backfill_queue_max_messages,
            webhook_queue_workers,
            webhook_queue_max_messages,
            sfs_uploader_workers,
            redis_rate_limit_reqs,
            redis_rate_limit_window_secs,
            environment,
            auth_service_secret_key,
            auth_service_url,
            static_file_service_url,
            document_storage_service_url,
            connection_gateway_url,
            cloudfront_distribution_url,
            cloudfront_signer_public_key_id,
            cloudfront_signer_private_key,
            presigned_url_ttl_secs,
        })
    }
}
