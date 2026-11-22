use anyhow::Context;
use entity_registry::NonUserOwners;
use macro_auth::InternalApiKey;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use macro_service_urls::AiEditingWorkerUrl;
use secretsmanager_client::LocalOrRemoteSecret;

use crate::cognition::core::constants::DEFAULT_DOCUMENT_BATCH_LIMIT;

#[cfg(test)]
mod test;

env_vars!(
    pub struct DatabaseUrl;
    pub struct DocumentStorageBucket;
    pub struct DocumentStorageServiceAuthKey;
    pub struct SyncServiceAuthKey;
    pub struct AuthenticationServiceUrl;
    pub struct AuthenticationServiceSecretKey;
    pub struct RedisHost;
    pub struct DocxDocumentUploadBucket;
    pub struct DocumentStorageServiceCloudfrontDistributionUrl;
    pub struct DocumentStorageServiceCloudfrontSignerPublicKeyId;
    pub struct DocumentStorageServiceCloudfrontSignerPrivateKey;
    pub struct McpCredentialsKeySecretName;
    pub struct DocumentPermissionJwt;
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub struct KafkaBrokers;
);

maybe_env_vars!(
    pub struct DocumentBatchLimit;
    /// Rollout gate for entities owned by bots or teams.
    pub struct EnableNonUserOwners;
    /// OAuth client ID for the Pipedream API (Pipedream project settings).
    /// When unset (along with the other Pipedream credentials), the
    /// Pipedream MCP endpoints answer 501 and its toolsets come up empty.
    pub struct PipedreamClientId;
    /// OAuth client secret for the Pipedream API.
    pub struct PipedreamClientSecret;
    /// The Pipedream Connect project ID (`proj_...`).
    pub struct PipedreamProjectId;
    /// The Pipedream project environment (`development` or `production`).
    /// Defaults by deploy environment: production in prd, development
    /// elsewhere.
    pub struct PipedreamEnvironment;
    /// Base URL of the Pipedream API. Defaults to `https://api.pipedream.com`.
    pub struct PipedreamApiUrl;
    /// URL of Pipedream's remote MCP server. Defaults to
    /// `https://remote.mcp.pipedream.net`.
    pub struct PipedreamMcpUrl;
    /// Comma-separated browser origins allowed to embed Pipedream's hosted
    /// Connect UI (sent as the Connect token's `allowed_origins`). Defaults
    /// by deploy environment: the app origin (`https://macro.com` /
    /// `https://dev.macro.com`) plus localhost outside production.
    pub struct PipedreamAllowedOrigins;
    /// Absolute URL Pipedream posts connect-flow outcomes to, minted into
    /// every Connect token. Must carry the shared secret as a `secret` query
    /// parameter, matching `PIPEDREAM_WEBHOOK_SECRET`. When unset (or when
    /// the secret is unset), connect tokens are minted without a webhook.
    pub struct PipedreamWebhookUri;
    /// Shared secret guarding the public Pipedream webhook route, which is
    /// unauthenticated because Pipedream is the caller. When unset, the
    /// webhook route is not mounted.
    pub struct PipedreamWebhookSecret;
    /// PostHog project token. When unset, integration analytics are not sent.
    pub struct PosthogApiKey;
    /// PostHog ingestion origin. Falls back to the US origin when unset.
    pub struct PosthogHost;
    /// Macro's customer key for the Macro Connect API. When unset, Connect
    /// is off and every connection goes through Pipedream.
    pub struct ConnectCustomerKey;
);

/// The configuration parameters for the application.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// Default-off quota admission and prospective usage counting.
    #[macro_config_default(ai_usage::AiUsageEnforcement::Disabled)]
    pub enable_ai_usage_enforcement: ai_usage::AiUsageEnforcement,
    /// Default-off settlement of usage past allowances. When enabled, counted
    /// usage recorded here asks the authentication service to settle; that
    /// service's own policy decides whether it does.
    #[macro_config_default(ai_billing::AiUsageBilling::Disabled)]
    pub enable_ai_usage_billing: ai_billing::AiUsageBilling,
    /// Optional TypeSafe credential for named decisions.
    /// Without it, these endpoints respond with 503.
    pub typesafe_api_key: jev::outbound::TypesafeApiKey,
    /// The free plan's hard monthly AI cap, in cents at provider cost.
    /// Mandatory; set in Doppler.
    pub ai_usage_free_included_allowance_cents: ai_billing::IncludedAllowanceCents,
    /// In-plan AI allowance per Premium seat per period, in cents at provider
    /// cost. Mandatory; set in Doppler.
    pub ai_usage_included_allowance_cents: ai_billing::IncludedAllowanceCents,
    /// In-plan AI allowance per Max seat per period, in cents at provider
    /// cost. Mandatory; set in Doppler.
    pub ai_usage_max_included_allowance_cents: ai_billing::IncludedAllowanceCents,
    /// Markup on paid AI usage past the allowance, as a whole percent of
    /// provider cost. Mandatory; set in Doppler.
    pub ai_usage_overage_markup_percent: ai_billing::OverageMarkupPercent,
    /// The connection URL for the Postgres database this application should use.
    pub database_url: DatabaseUrl,
    /// The port to listen for HTTP requests on.
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// The maximum number of results in a document query
    #[macro_config_default(DEFAULT_DOCUMENT_BATCH_LIMIT)]
    pub document_batch_limit: i64,
    /// document storage bucket
    pub document_storage_bucket: DocumentStorageBucket,
    /// document storage service auth key
    pub document_storage_service_auth_key: DocumentStorageServiceAuthKey,
    pub sync_service_auth_key: LocalOrRemoteSecret<SyncServiceAuthKey>,
    /// Authentication service key or deployed Secrets Manager name.
    pub authentication_service_secret_key: LocalOrRemoteSecret<AuthenticationServiceSecretKey>,
    /// Redis host for stream service
    pub redis_host: RedisHost,
    /// The S3 bucket for DOCX document uploads
    pub docx_document_upload_bucket: DocxDocumentUploadBucket,
    /// CloudFront distribution URL for document storage
    pub document_storage_service_cloudfront_distribution_url:
        DocumentStorageServiceCloudfrontDistributionUrl,
    /// CloudFront signer public key ID
    pub document_storage_service_cloudfront_signer_public_key_id:
        DocumentStorageServiceCloudfrontSignerPublicKeyId,
    /// CloudFront signer private key (secret name or value)
    pub document_storage_service_cloudfront_signer_private_key:
        LocalOrRemoteSecret<DocumentStorageServiceCloudfrontSignerPrivateKey>,
    /// MCP credentials encryption key (base64-encoded, secret name or value)
    pub mcp_credentials_key_secret_name: LocalOrRemoteSecret<McpCredentialsKeySecretName>,
    /// OAuth client ID for the Pipedream API.
    pub pipedream_client_id: PipedreamClientId,
    /// OAuth client secret for the Pipedream API.
    pub pipedream_client_secret: PipedreamClientSecret,
    /// The Pipedream Connect project ID.
    pub pipedream_project_id: PipedreamProjectId,
    /// The Pipedream project environment.
    pub pipedream_environment: PipedreamEnvironment,
    /// Base URL of the Pipedream API.
    pub pipedream_api_url: PipedreamApiUrl,
    /// URL of Pipedream's remote MCP server.
    pub pipedream_mcp_url: PipedreamMcpUrl,
    /// Browser origins allowed to embed Pipedream's hosted Connect UI.
    pub pipedream_allowed_origins: PipedreamAllowedOrigins,
    /// URL Pipedream posts connect-flow outcomes to.
    pub pipedream_webhook_uri: PipedreamWebhookUri,
    /// Shared secret guarding the public Pipedream webhook route.
    pub pipedream_webhook_secret: PipedreamWebhookSecret,
    /// PostHog project token for integration connect/disconnect analytics.
    pub posthog_api_key: PosthogApiKey,
    /// PostHog ingestion origin for integration analytics.
    pub posthog_host: PosthogHost,
    /// Customer key for Macro Connect, which serves the apps it has in its
    /// catalog to users in the `macro-connect` rollout.
    pub connect_customer_key: ConnectCustomerKey,
    /// The internal api key
    pub internal_api_key: InternalApiKey,
    /// AI editing worker URL
    #[macro_config_default(AiEditingWorkerUrl::unwrap_new().to_string())]
    pub ai_editing_worker_url: String,
    /// JWT secret for minting document permission tokens for the editing worker.
    pub document_permission_jwt: DocumentPermissionJwt,
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub kafka_brokers: KafkaBrokers,
    /// Lets a team-scoped bot with no acting user own the chats it creates.
    pub enable_non_user_owners: EnableNonUserOwners,
}

impl Config {
    /// The AI pricing every billing component is composed with. Every value
    /// is validated when the configuration loads.
    pub fn ai_pricing(&self) -> ai_billing::AiPricing {
        ai_billing::AiPricing::new(
            ai_billing::PlanAllowances {
                free: self.ai_usage_free_included_allowance_cents,
                premium: self.ai_usage_included_allowance_cents,
                max: self.ai_usage_max_included_allowance_cents,
            },
            self.ai_usage_overage_markup_percent,
        )
    }

    #[tracing::instrument(err, skip_all)]
    pub fn from_env() -> anyhow::Result<Self> {
        let enforcement = ai_usage::config::load_ai_usage_enforcement()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let billing = ai_billing::config::load_ai_usage_billing()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let mut config =
            macro_config::ConfigLoader::load::<Config>().context("failed to load config")?;
        config.enable_ai_usage_enforcement = enforcement;
        config.enable_ai_usage_billing = billing;
        Ok(config)
    }

    /// What this process's one connectors composition is built from. Call
    /// it on a configuration whose secrets are resolved.
    pub fn connectors_config(&self) -> anyhow::Result<connectors::composition::ConnectorsConfig> {
        let mcp_credentials_key = connectors::composition::AesKey::try_from(
            self.mcp_credentials_key_secret_name.as_ref(),
        )
        .context("invalid MCP credentials encryption key")?;
        let value = |value: Option<&str>| {
            value
                .filter(|value| !value.trim().is_empty())
                .map(str::to_owned)
        };
        let pipedream = ai_tools::connectors_config::pipedream_settings(
            self.environment,
            ai_tools::connectors_config::PipedreamEnvValues {
                client_id: value(self.pipedream_client_id.value()),
                client_secret: value(self.pipedream_client_secret.value()),
                project_id: value(self.pipedream_project_id.value()),
                environment: value(self.pipedream_environment.value()),
                api_url: value(self.pipedream_api_url.value()),
                mcp_url: value(self.pipedream_mcp_url.value()),
            },
            self.pipedream_allowed_origins(),
            self.pipedream_webhook_uri(),
        );

        Ok(connectors::composition::ConnectorsConfig {
            environment: self.environment,
            app_origin: ai_tools::connectors_config::app_origin()?,
            mcp_credentials_key,
            mcp_oauth_client: ai_tools::connectors_config::mcp_oauth_client()?,
            mcp_pre_registered: connectors::composition::PreRegisteredProviders::from_env()?,
            pipedream,
            connect: ai_tools::connectors_config::connect_config(
                self.connect_customer_key.value(),
            )?,
            feature_flags: ai_tools::connectors_config::feature_flags_config(
                self.posthog_api_key.value(),
                self.posthog_host.value(),
            ),
        })
    }

    /// Browser origins allowed to embed Pipedream's hosted Connect UI:
    /// `PIPEDREAM_ALLOWED_ORIGINS`, or the app's origins for this environment.
    pub fn pipedream_allowed_origins(&self) -> Vec<String> {
        match self.pipedream_allowed_origins.value() {
            Some(origins) => origins
                .split(',')
                .map(|origin| origin.trim().to_owned())
                .filter(|origin| !origin.is_empty())
                .collect(),
            None => match self.environment {
                Environment::Production => vec!["https://macro.com".to_owned()],
                Environment::Develop => vec![
                    "https://dev.macro.com".to_owned(),
                    "http://localhost:3000".to_owned(),
                ],
                Environment::Local => vec!["http://localhost:3000".to_owned()],
            },
        }
    }

    /// Where Pipedream posts connect-flow outcomes. Needs both the URI and
    /// the secret guarding the route: a half-set pair is ignored, so no
    /// callback is minted that this process cannot serve.
    pub fn pipedream_webhook_uri(&self) -> Option<String> {
        match (
            self.pipedream_webhook_uri.value(),
            self.pipedream_webhook_secret.value(),
        ) {
            (Some(uri), Some(_)) => Some(uri.to_owned()),
            (None, None) => None,
            _ => {
                tracing::warn!(
                    "ignoring incomplete Pipedream webhook config; set both PIPEDREAM_WEBHOOK_URI and PIPEDREAM_WEBHOOK_SECRET"
                );
                None
            }
        }
    }

    pub fn non_user_owners(&self) -> anyhow::Result<NonUserOwners> {
        NonUserOwners::from_config_value(self.enable_non_user_owners.value())
            .context("ENABLE_NON_USER_OWNERS must be `true` or `false`")
    }

    #[cfg(test)]
    pub fn new_empty_for_test() -> Self {
        Config {
            enable_ai_usage_enforcement: ai_usage::AiUsageEnforcement::Disabled,
            enable_ai_usage_billing: ai_billing::AiUsageBilling::Disabled,
            typesafe_api_key: jev::outbound::TypesafeApiKey::Unset,
            ai_usage_free_included_allowance_cents: ai_billing::IncludedAllowanceCents::new(500)
                .unwrap(),
            ai_usage_included_allowance_cents: ai_billing::IncludedAllowanceCents::new(2_000)
                .unwrap(),
            ai_usage_max_included_allowance_cents: ai_billing::IncludedAllowanceCents::new(10_000)
                .unwrap(),
            ai_usage_overage_markup_percent: ai_billing::OverageMarkupPercent::new(5).unwrap(),
            environment: Environment::Local,
            database_url: DatabaseUrl::Comptime("DATABASE_URL"),
            port: Default::default(),
            document_batch_limit: DEFAULT_DOCUMENT_BATCH_LIMIT,
            document_storage_bucket: DocumentStorageBucket::Comptime("DOCUMENT_STORAGE_BUCKET"),
            document_storage_service_auth_key: DocumentStorageServiceAuthKey::Comptime(
                "DOCUMENT_STORAGE_SERVICE_AUTH_KEY",
            ),
            sync_service_auth_key: LocalOrRemoteSecret::Local(SyncServiceAuthKey::Comptime(
                "SYNC_SERVICE_AUTH_KEY",
            )),
            authentication_service_secret_key: LocalOrRemoteSecret::Local(
                AuthenticationServiceSecretKey::Comptime("AUTHENTICATION_SERVICE_SECRET_KEY"),
            ),
            redis_host: RedisHost::Comptime("REDIS_HOST"),
            docx_document_upload_bucket: DocxDocumentUploadBucket::Comptime(
                "DOCX_DOCUMENT_UPLOAD_BUCKET",
            ),
            document_storage_service_cloudfront_distribution_url:
                DocumentStorageServiceCloudfrontDistributionUrl::Comptime(
                    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL",
                ),
            document_storage_service_cloudfront_signer_public_key_id:
                DocumentStorageServiceCloudfrontSignerPublicKeyId::Comptime(
                    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID",
                ),
            document_storage_service_cloudfront_signer_private_key: LocalOrRemoteSecret::Local(
                DocumentStorageServiceCloudfrontSignerPrivateKey::Comptime(
                    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY",
                ),
            ),
            mcp_credentials_key_secret_name: LocalOrRemoteSecret::Local(
                McpCredentialsKeySecretName::Comptime("MCP_CREDENTIALS_KEY_SECRET_NAME"),
            ),
            pipedream_client_id: PipedreamClientId::Unset,
            pipedream_client_secret: PipedreamClientSecret::Unset,
            pipedream_project_id: PipedreamProjectId::Unset,
            pipedream_environment: PipedreamEnvironment::Unset,
            pipedream_api_url: PipedreamApiUrl::Unset,
            pipedream_mcp_url: PipedreamMcpUrl::Unset,
            pipedream_allowed_origins: PipedreamAllowedOrigins::Unset,
            pipedream_webhook_uri: PipedreamWebhookUri::Unset,
            pipedream_webhook_secret: PipedreamWebhookSecret::Unset,
            posthog_api_key: PosthogApiKey::Unset,
            posthog_host: PosthogHost::Unset,
            connect_customer_key: ConnectCustomerKey::Unset,
            internal_api_key: InternalApiKey::Comptime(""),
            ai_editing_worker_url: AiEditingWorkerUrl::unwrap_new().to_string(),
            document_permission_jwt: DocumentPermissionJwt::Comptime("DOCUMENT_PERMISSION_JWT"),
            kafka_brokers: KafkaBrokers::Comptime("localhost:9092"),
            enable_non_user_owners: EnableNonUserOwners::Unset,
        }
    }
}
