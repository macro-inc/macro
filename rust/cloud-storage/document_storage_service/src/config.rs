use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use secretsmanager_client::LocalOrRemoteSecret;

pub const DEFAULT_PRESIGNED_URL_EXPIRY_SECONDS: u64 = 900; // 15 minutes
pub const DEFAULT_PRESIGNED_URL_BROWSER_CACHE_EXPIRY_SECONDS: u64 = 840; // remember that this is just a suggestion to the client browser 

env_vars! {
    pub struct DatabaseUrl;
    pub struct DatabaseUrlReadonly;
    pub struct DocumentStorageBucket;
    pub struct DocxDocumentUploadBucket;
    pub struct DocumentDeleteQueue;
    pub struct DocumentStorageServiceCloudfrontDistributionUrl;
    pub struct DocumentStorageServiceCloudfrontSignerPublicKeyId;
    pub struct RedisUri;
    pub struct NotificationQueue;
    pub struct SearchEventQueue;
    pub struct BulkUploadRequestsTable;
    pub struct UploadStagingBucket;
    pub struct SyncServiceAuthKey;
    pub struct OpensearchUrl;
    pub struct OpensearchUsername;
    pub struct OpensearchPassword;
    pub struct ContactsQueue;
    pub struct GithubSyncAppUrl;
    pub struct GithubSyncAppClientId;
    pub struct LivekitServerUrl;
    pub struct LivekitApiKey;
    pub struct LivekitApiSecret;
    /// OpenAI API key used to generate task-dedup embeddings. Required —
    /// injected as `OPENAI_API_KEY` from the `openai-key` secret by the
    /// infra stack, the same way `document_cognition_service` consumes it.
    pub struct OpenaiApiKey;
    pub struct DocumentLimit;
    pub struct DocumentStorageServicePresignedUrlExpirySeconds;
    pub struct DocumentStorageServicePresignedUrlBrowserCacheExpirySeconds;
    pub struct DocumentStorageServiceCloudfrontSignerPrivateKey;
    #[derive(Clone)]
    pub struct DocumentPermissionJwtSecretKey;
    pub struct GithubWebhookSecretKey;
    pub struct GithubSyncAppPemSecretKey;
    pub struct CalWebhookSecretKey;
    pub struct CalEventTypeContentNamesKey;
    pub struct MetaPixelId;
    pub struct MetaAccessToken;
    #[derive(Clone)]
    pub struct DocumentStorageServiceAuthKey;
    pub struct InternalApiSecretKey;
}

maybe_env_vars! {
    /// Optional name of the LiveKit agent to dispatch for call transcription.
    pub struct LivekitTranscriptionAgentName;
    /// Shared secret for internal call endpoints (e.g. transcript ingestion from the agent).
    pub struct InternalCallSecret;
    /// Public base URL of this service (e.g. `https://cloud-storage.macro.com`),
    /// used to build the ring-status URL included in VoIP push payloads.
    /// When unset, payloads omit the URL and native ring-status polling is off.
    pub struct CallRingStatusBaseUrl;
    /// S3 bucket for call recording egress.
    pub struct CallRecordingS3Bucket;
    /// AWS region for the call recording S3 bucket.
    pub struct CallRecordingS3Region;
    /// AWS access key for call recording S3 uploads.
    pub struct CallRecordingS3AccessKey;
    /// AWS secret key for call recording S3 uploads.
    pub struct CallRecordingS3Secret;
    /// Optional Meta test event code — routes events to Meta's test events
    /// view instead of production tracking.
    pub struct MetaTestEventCode;
}

/// The configuration parameters for the application.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    pub database_url: DatabaseUrl,
    pub database_url_readonly: DatabaseUrlReadonly,
    pub document_storage_bucket: DocumentStorageBucket,
    pub docx_document_upload_bucket: DocxDocumentUploadBucket,
    pub document_delete_queue: DocumentDeleteQueue,
    pub document_storage_service_cloudfront_distribution_url:
        DocumentStorageServiceCloudfrontDistributionUrl,
    pub document_storage_service_cloudfront_signer_public_key_id:
        DocumentStorageServiceCloudfrontSignerPublicKeyId,
    pub redis_uri: RedisUri,
    pub notification_queue: NotificationQueue,
    pub search_event_queue: SearchEventQueue,
    pub bulk_upload_requests_table: BulkUploadRequestsTable,
    pub upload_staging_bucket: UploadStagingBucket,
    pub sync_service_auth_key: LocalOrRemoteSecret<SyncServiceAuthKey>,
    pub opensearch_url: OpensearchUrl,
    pub opensearch_username: OpensearchUsername,
    pub opensearch_password: OpensearchPassword,
    pub contacts_queue: ContactsQueue,
    pub github_sync_app_url: GithubSyncAppUrl,
    pub github_sync_app_client_id: GithubSyncAppClientId,
    pub livekit_server_url: LivekitServerUrl,
    pub livekit_api_key: LivekitApiKey,
    pub livekit_api_secret: LivekitApiSecret,
    pub openai_api_key: OpenaiApiKey,
    pub github_webhook_secret_key: LocalOrRemoteSecret<GithubWebhookSecretKey>,
    pub github_sync_app_pem_secret_key: LocalOrRemoteSecret<GithubSyncAppPemSecretKey>,
    pub cal_webhook_secret_key: CalWebhookSecretKey,
    pub cal_event_type_content_names_key: CalEventTypeContentNamesKey,
    pub meta_pixel_id: MetaPixelId,
    pub meta_access_token: MetaAccessToken,
    pub document_storage_service_auth_key: DocumentStorageServiceAuthKey,
    pub internal_api_secret_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    // pub vars: EnvVars,
    /// The port to listen for HTTP requests on.
    #[macro_config_default(8080)]
    pub port: usize,

    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,

    /// Maximum number of SQS messages to receive per poll for the delete document worker
    #[macro_config_default(10)]
    pub queue_max_messages: i32,
    /// SQS long-poll wait time in seconds for the delete document worker
    #[macro_config_default(4)]
    pub queue_wait_time_seconds: i32,

    /// The document limit for free users
    #[macro_config_default(20)]
    pub document_limit: u64,

    /// The number of seconds a presigned url is valid for
    #[macro_config_default(DEFAULT_PRESIGNED_URL_EXPIRY_SECONDS)]
    pub document_storage_service_presigned_url_expiry_seconds: u64,
    /// The number of seconds a browser cache for a presigned url is valid for
    #[macro_config_default(DEFAULT_PRESIGNED_URL_BROWSER_CACHE_EXPIRY_SECONDS)]
    pub document_storage_service_presigned_url_browser_cache_expiry_seconds: u64,

    pub document_storage_service_cloudfront_signer_private_key:
        LocalOrRemoteSecret<DocumentStorageServiceCloudfrontSignerPrivateKey>,

    pub document_permission_jwt_secret_key: LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>,

    pub livekit_transcription_agent_name: LivekitTranscriptionAgentName,
    pub internal_call_secret: InternalCallSecret,
    pub call_ring_status_base_url: CallRingStatusBaseUrl,
    pub call_recording_s3_bucket: CallRecordingS3Bucket,
    pub call_recording_s3_region: CallRecordingS3Region,
    pub call_recording_s3_access_key: CallRecordingS3AccessKey,
    pub call_recording_s3_secret: CallRecordingS3Secret,
    pub meta_test_event_code: MetaTestEventCode,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>().context("failed to load config")
    }
}
