pub use macro_env::Environment;
use macro_env_var::env_var;
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

    /// The document limit for free users
    pub document_limit: u64,

    /// The number of seconds a presigned url is valid for
    pub presigned_url_expiry_seconds: u64,
    /// The number of seconds a browser cache for a presigned url is valid for
    pub presigned_url_browser_cache_expiry_seconds: u64,
    pub cloudfront_signer_private_key: LocalOrRemoteSecret<CloudfrontSignerPrivateKeySecretName>,

    pub document_permission_jwt: LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>,
}

env_var! {
    struct EnvVars {
        pub DatabaseUrl,
        pub DocumentStorageBucket,
        pub DocxDocumentUploadBucket,
        pub DocumentDeleteQueue,
        pub CloudfrontDistributionUrl,
        pub CloudfrontSignerPublicKeyId,
        pub RedisUri,
        pub NotificationQueue,
        pub SearchEventQueue,
        pub CommsServiceUrl,
        pub EmailServiceUrl,
        pub AffiliateUsersTable,
        pub ConnectionGatewayUrl,
        pub BulkUploadRequestsTable,
        pub UploadStagingBucket,
        pub SyncServiceUrl,
        pub SyncServiceAuthKey,
    }
}

env_var! { struct Port; }
env_var! { struct DocumentLimit; }
env_var! { struct PresignedUrlExpirySeconds; }
env_var! { struct PresignedUrlBrowserCacheExpirySeconds; }
env_var! { pub struct CloudfrontSignerPrivateKeySecretName; }
env_var! { pub struct DocumentPermissionJwtSecretKey; }

impl Config {
    pub fn from_env(
        cloudfront_signer_private_key: LocalOrRemoteSecret<CloudfrontSignerPrivateKeySecretName>,
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

        let presigned_url_expiry_seconds = PresignedUrlExpirySeconds::new()
            .ok()
            .and_then(|v| v.as_ref().parse::<u64>().ok())
            .unwrap_or(DEFAULT_PRESIGNED_URL_EXPIRY_SECONDS);

        let presigned_url_browser_cache_expiry_seconds =
            PresignedUrlBrowserCacheExpirySeconds::new()
                .ok()
                .and_then(|v| v.as_ref().parse::<u64>().ok())
                .unwrap_or(DEFAULT_PRESIGNED_URL_BROWSER_CACHE_EXPIRY_SECONDS);

        let vars = EnvVars::new()?;

        Ok(Config {
            vars,
            port,
            environment,
            document_limit,
            presigned_url_expiry_seconds,
            presigned_url_browser_cache_expiry_seconds,
            cloudfront_signer_private_key,
            document_permission_jwt,
        })
    }
}

pub const DEFAULT_PRESIGNED_URL_EXPIRY_SECONDS: u64 = 900; // 15 minutes
pub const DEFAULT_PRESIGNED_URL_BROWSER_CACHE_EXPIRY_SECONDS: u64 = 840; // remember that this is just a suggestion to the client browser, the API Gateway settings determine the actual cache time on the server
