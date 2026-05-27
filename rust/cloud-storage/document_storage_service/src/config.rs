pub use macro_env::Environment;
use macro_env_var::{env_var, maybe_env_var};
use secretsmanager_client::LocalOrRemoteSecret;

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in document-storage-service root for details.
pub struct Config {
    pub vars: EnvVars,

    /// The port to listen for HTTP requests on.
    pub port: usize,

    /// The environment we are in
    pub environment: Environment,

    /// Maximum number of SQS messages to receive per poll for the delete document worker
    pub queue_max_messages: i32,
    /// SQS long-poll wait time in seconds for the delete document worker
    pub queue_wait_time_seconds: i32,

    /// The document limit for free users
    pub document_limit: u64,

    /// The number of seconds a presigned url is valid for
    pub document_storage_service_presigned_url_expiry_seconds: u64,
    /// The number of seconds a browser cache for a presigned url is valid for
    pub document_storage_service_presigned_url_browser_cache_expiry_seconds: u64,
    pub document_storage_service_cloudfront_signer_private_key:
        LocalOrRemoteSecret<DocumentStorageServiceCloudfrontSignerPrivateKeySecretName>,

    pub document_permission_jwt: LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>,
}

env_var! {
    struct EnvVars {
        pub DatabaseUrl,
        pub DatabaseUrlReadonly,
        pub DocumentStorageBucket,
        pub DocxDocumentUploadBucket,
        pub DocumentDeleteQueue,
        pub DocumentStorageServiceCloudfrontDistributionUrl,
        pub DocumentStorageServiceCloudfrontSignerPublicKeyId,
        pub RedisUri,
        pub NotificationQueue,
        pub NotificationIngressQueue,
        pub SearchEventQueue,
        pub ConnectionGatewayUrl,
        pub BulkUploadRequestsTable,
        pub UploadStagingBucket,
        pub SyncServiceUrl,
        pub SyncServiceAuthKey,
        pub LexicalServiceUrl,
        pub OpensearchUrl,
        pub OpensearchUsername,
        pub OpensearchPassword,
        pub ContactsQueue,
        pub GithubSyncAppUrl,
        pub GithubSyncAppClientId,
        pub LivekitServerUrl,
        pub LivekitApiKey,
        pub LivekitApiSecret,
    }
}

maybe_env_var! {
    /// Optional name of the LiveKit agent to dispatch for call transcription.
    pub struct LivekitTranscriptionAgentName;
}

maybe_env_var! {
    /// Shared secret for internal call endpoints (e.g. transcript ingestion from the agent).
    pub struct InternalCallSecret;
}

maybe_env_var! {
    /// S3 bucket for call recording egress.
    pub struct CallRecordingS3Bucket;
}
maybe_env_var! {
    /// AWS region for the call recording S3 bucket.
    pub struct CallRecordingS3Region;
}
maybe_env_var! {
    /// AWS access key for call recording S3 uploads.
    pub struct CallRecordingS3AccessKey;
}
maybe_env_var! {
    /// AWS secret key for call recording S3 uploads.
    pub struct CallRecordingS3Secret;
}

env_var! { struct Port; }
env_var! { struct DocumentLimit; }
env_var! { struct DocumentStorageServicePresignedUrlExpirySeconds; }
env_var! { struct DocumentStorageServicePresignedUrlBrowserCacheExpirySeconds; }
env_var! { pub struct DocumentStorageServiceCloudfrontSignerPrivateKeySecretName; }
env_var! {
    #[derive(Clone)]
    pub struct DocumentPermissionJwtSecretKey;
}
env_var! {
    pub struct GithubWebhookSecretKey;
}

env_var! {
    pub struct GithubSyncAppPemSecretKey;
}

env_var! {
    pub struct CalWebhookSecretKey;
}

env_var! {
    /// Secrets Manager secret name holding the JSON map from cal.com
    /// `eventTypeId` to Meta `content_name`.
    pub struct CalEventTypeContentNamesKey;
}

env_var! {
    /// Meta (Facebook) Conversions API pixel id. Required — pair with
    /// [`MetaAccessToken`] for cal → Meta Lead tracking. Set to a dummy
    /// value locally; it's only exercised when a cal webhook fires.
    pub struct MetaPixelId;
}

env_var! {
    /// Meta (Facebook) Conversions API access token. Required — see
    /// [`MetaPixelId`].
    pub struct MetaAccessToken;
}

maybe_env_var! {
    /// Optional Meta test event code — routes events to Meta's test events
    /// view instead of production tracking.
    pub struct MetaTestEventCode;
}

impl Config {
    pub fn from_env(
        document_storage_service_cloudfront_signer_private_key: LocalOrRemoteSecret<
            DocumentStorageServiceCloudfrontSignerPrivateKeySecretName,
        >,
        document_permission_jwt: LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>,
    ) -> anyhow::Result<Self> {
        let environment = Environment::new_or_prod();

        let port = Port::new()
            .ok()
            .and_then(|v| v.as_ref().parse::<usize>().ok())
            .unwrap_or(8080);

        let document_limit = DocumentLimit::new()
            .ok()
            .and_then(|v| v.as_ref().parse::<u64>().ok())
            .unwrap_or(20);

        let document_storage_service_presigned_url_expiry_seconds =
            DocumentStorageServicePresignedUrlExpirySeconds::new()
                .ok()
                .and_then(|v| v.as_ref().parse::<u64>().ok())
                .unwrap_or(DEFAULT_PRESIGNED_URL_EXPIRY_SECONDS);

        let document_storage_service_presigned_url_browser_cache_expiry_seconds =
            DocumentStorageServicePresignedUrlBrowserCacheExpirySeconds::new()
                .ok()
                .and_then(|v| v.as_ref().parse::<u64>().ok())
                .unwrap_or(DEFAULT_PRESIGNED_URL_BROWSER_CACHE_EXPIRY_SECONDS);

        let queue_max_messages: i32 = std::env::var("QUEUE_MAX_MESSAGES")
            .unwrap_or("10".to_string())
            .parse()
            .unwrap_or(10);

        let queue_wait_time_seconds: i32 = std::env::var("QUEUE_WAIT_TIME_SECONDS")
            .unwrap_or("4".to_string())
            .parse()
            .unwrap_or(4);

        let vars = EnvVars::new()?;

        Ok(Config {
            vars,
            port,
            environment,
            queue_max_messages,
            queue_wait_time_seconds,
            document_limit,
            document_storage_service_presigned_url_expiry_seconds,
            document_storage_service_presigned_url_browser_cache_expiry_seconds,
            document_storage_service_cloudfront_signer_private_key,
            document_permission_jwt,
        })
    }
}

pub const DEFAULT_PRESIGNED_URL_EXPIRY_SECONDS: u64 = 900; // 15 minutes
pub const DEFAULT_PRESIGNED_URL_BROWSER_CACHE_EXPIRY_SECONDS: u64 = 840; // remember that this is just a suggestion to the client browser 
