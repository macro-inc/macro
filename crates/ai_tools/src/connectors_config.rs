//! What a host builds its one [`connectors::Connectors`]
//! from: [`connectors_config_from_env`] for hosts that read the shared
//! AI-tools environment, and the pieces every host's configuration shares.

use anyhow::Context;
use connectors::composition::{
    AesKey, AutodeskConfig, ConnectConfig, ConnectorsConfig, FeatureFlagsConfig,
    OAuthClientMetadata, PIPEDREAM_DEFAULT_API_URL, PIPEDREAM_DEFAULT_MCP_URL, PipedreamConfig,
    PipedreamSettings, PreRegisteredProviders,
};
use macro_env::Environment;
use macro_env_var::maybe_env_var;
use secretsmanager_client::{SecretManager, SecretsManager};

maybe_env_var! {
    struct ConnectorsEnv {
        /// Secrets Manager name (or local value) of the key native MCP
        /// servers' credentials are encrypted with.
        McpCredentialsKeySecretName,
        /// OAuth client ID for the Pipedream API.
        PipedreamClientId,
        /// OAuth client secret for the Pipedream API.
        PipedreamClientSecret,
        /// The Pipedream Connect project ID (`proj_...`).
        PipedreamProjectId,
        /// The Pipedream project environment (`development` or `production`).
        PipedreamEnvironment,
        /// Base URL of the Pipedream API.
        PipedreamApiUrl,
        /// Base URL of the Pipedream MCP server.
        PipedreamMcpUrl,
        /// Macro's customer key for the Macro Connect API.
        ConnectCustomerKey,
        /// PostHog project token.
        PosthogApiKey,
        /// Regional PostHog origin; defaults to the US origin.
        PosthogHost,
    }
}

maybe_env_var! {
    struct AutodeskEnv {
        /// Macro's APS (Autodesk Platform Services) app's client id.
        AutodeskClientId,
        /// Macro's APS app's client secret.
        AutodeskClientSecret,
        /// The KMS key (id, ARN or alias) that wraps the grants of REST apps
        /// Macro signs in to itself, Autodesk's included.
        ApiAppGrantKmsKeyId,
    }
}

/// PostHog's US ingestion origin, used when `POSTHOG_HOST` is unset.
const DEFAULT_POSTHOG_HOST: &str = "https://us.i.posthog.com";

/// The connectors configuration of a host that reads the shared AI-tools
/// environment, or `None` without the MCP credentials key (no connectors on
/// that host).
///
/// Such a host serves no connect flow, so Pipedream gets no allowed origins
/// and no webhook.
pub async fn connectors_config_from_env(
    environment: Environment,
) -> anyhow::Result<Option<ConnectorsConfig>> {
    let env = ConnectorsEnv::new();
    // A set but blank variable is unset.
    macro_rules! value {
        ($field:ident) => {
            env.$field
                .as_ref()
                .and_then(|value| value.value())
                .filter(|value| !value.trim().is_empty())
                .map(str::to_owned)
        };
    }
    let Some(secret_name) = value!(mcp_credentials_key_secret_name) else {
        tracing::warn!("MCP_CREDENTIALS_KEY_SECRET_NAME is unset: this host has no connectors");
        return Ok(None);
    };
    let secrets = SecretsManager::new(aws_sdk_secretsmanager::Client::new(
        &macro_aws_config::get_macro_aws_config().await,
    ));
    let key = secrets
        .get_maybe_secret_value(environment, secret_name.as_str())
        .await
        .context("failed to load MCP credentials encryption key")?;
    let mcp_credentials_key =
        AesKey::try_from(key.as_ref()).context("invalid MCP credentials encryption key")?;

    let pipedream = pipedream_settings(
        environment,
        PipedreamEnvValues {
            client_id: value!(pipedream_client_id),
            client_secret: value!(pipedream_client_secret),
            project_id: value!(pipedream_project_id),
            environment: value!(pipedream_environment),
            api_url: value!(pipedream_api_url),
            mcp_url: value!(pipedream_mcp_url),
        },
        Vec::new(),
        None,
    );

    Ok(Some(ConnectorsConfig {
        environment,
        app_origin: app_origin()?,
        mcp_credentials_key,
        mcp_oauth_client: mcp_oauth_client()?,
        mcp_pre_registered: pre_registered_providers(),
        pipedream,
        connect: connect_config(value!(connect_customer_key).as_deref())?,
        autodesk: autodesk_config().await?,
        feature_flags: feature_flags_config(
            value!(posthog_api_key).as_deref(),
            value!(posthog_host).as_deref(),
        ),
    }))
}

/// A host's Pipedream values, as read from its configuration.
#[derive(Default)]
pub struct PipedreamEnvValues {
    /// `PIPEDREAM_CLIENT_ID`.
    pub client_id: Option<String>,
    /// `PIPEDREAM_CLIENT_SECRET`.
    pub client_secret: Option<String>,
    /// `PIPEDREAM_PROJECT_ID`.
    pub project_id: Option<String>,
    /// `PIPEDREAM_ENVIRONMENT`; by default `production` in production and
    /// `development` elsewhere.
    pub environment: Option<String>,
    /// `PIPEDREAM_API_URL`.
    pub api_url: Option<String>,
    /// `PIPEDREAM_MCP_URL`.
    pub mcp_url: Option<String>,
}

/// Pipedream's settings, or `None` without a complete set of credentials:
/// an app cannot be half-connected.
pub fn pipedream_settings(
    environment: Environment,
    values: PipedreamEnvValues,
    allowed_origins: Vec<String>,
    webhook_uri: Option<String>,
) -> Option<PipedreamSettings> {
    let (Some(client_id), Some(client_secret), Some(project_id)) =
        (values.client_id, values.client_secret, values.project_id)
    else {
        tracing::info!("Pipedream credentials not set; Pipedream connectors disabled");
        return None;
    };
    Some(PipedreamSettings {
        client: PipedreamConfig {
            client_id,
            client_secret,
            project_id,
            environment: values.environment.unwrap_or_else(|| match environment {
                Environment::Production => "production".to_owned(),
                Environment::Develop | Environment::Local => "development".to_owned(),
            }),
            allowed_origins,
            api_url: values
                .api_url
                .unwrap_or_else(|| PIPEDREAM_DEFAULT_API_URL.to_owned()),
            mcp_url: values
                .mcp_url
                .unwrap_or_else(|| PIPEDREAM_DEFAULT_MCP_URL.to_owned()),
        },
        webhook_uri,
    })
}

/// Macro Connect for `customer_key`, or `None` without a key (Connect off).
/// Connect sends consent back to the cognition service's callback page,
/// whichever host builds it.
pub fn connect_config(customer_key: Option<&str>) -> anyhow::Result<Option<ConnectConfig>> {
    let Some(customer_key) = customer_key.filter(|key| !key.trim().is_empty()) else {
        return Ok(None);
    };
    Ok(Some(ConnectConfig {
        api_url: macro_service_urls::ConnectApiUrl::new()?.to_string(),
        customer_key: customer_key.to_owned(),
        callback_url: connect_callback_url()?,
    }))
}

/// Where Macro Connect sends the browser after consent.
fn connect_callback_url() -> anyhow::Result<url::Url> {
    let public_url = macro_service_urls::CognitionPublicUrl::new()?;
    url::Url::parse(&format!(
        "{}/pipedream/mcp/connect/callback",
        public_url.as_str().trim_end_matches('/')
    ))
    .context("Connect callback is not a URL")
}

/// Macro's own OAuth client at Autodesk, or `None` (Autodesk not
/// connectable) unless its client id, secret and the grants' KMS key are all
/// set. Its callback is cognition's public origin, like the MCP one.
pub async fn autodesk_config() -> anyhow::Result<Option<AutodeskConfig>> {
    let env = AutodeskEnv::new();
    let value = |field: Option<&str>| {
        field
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
    };
    let (Some(client_id), Some(client_secret), Some(kms_key_id)) = (
        value(
            env.autodesk_client_id
                .as_ref()
                .and_then(|value| value.value()),
        ),
        value(
            env.autodesk_client_secret
                .as_ref()
                .and_then(|value| value.value()),
        ),
        value(
            env.api_app_grant_kms_key_id
                .as_ref()
                .and_then(|value| value.value()),
        ),
    ) else {
        tracing::info!("Autodesk credentials not set; Autodesk is not connectable");
        return Ok(None);
    };

    let public_url = macro_service_urls::CognitionPublicUrl::new()?;
    let redirect_uri = url::Url::parse(&format!(
        "{}{}",
        public_url.as_str().trim_end_matches('/'),
        connectors::inbound::callbacks::APP_OAUTH_CALLBACK_PATH
    ))
    .context("the Autodesk callback is not a URL")?;
    let kms = aws_sdk_kms::Client::new(&macro_aws_config::get_macro_aws_config().await);

    Ok(Some(AutodeskConfig {
        client_id,
        client_secret: zeroize::Zeroizing::new(client_secret),
        redirect_uri,
        kms,
        kms_key_id,
    }))
}

/// The OAuth client Macro signs in to users' MCP servers as: its metadata
/// document and callback are served by cognition's public origin.
pub fn mcp_oauth_client() -> anyhow::Result<OAuthClientMetadata> {
    let public_url = macro_service_urls::CognitionPublicUrl::new()?;
    let public_url = public_url.as_str().trim_end_matches('/');
    Ok(OAuthClientMetadata::new(
        format!("{public_url}/mcp/servers/auth/client-metadata"),
        format!("{public_url}/mcp/servers/auth/callback"),
    ))
}

/// The web app's origin, where a user links GitHub.
pub fn app_origin() -> anyhow::Result<url::Url> {
    let origin = macro_service_urls::AppServiceUrl::new()?;
    url::Url::parse(origin.as_str()).context("the app origin is not a URL")
}

/// The MCP servers Macro holds a registered OAuth client for. A host without
/// their credentials signs in to none of them with one.
pub fn pre_registered_providers() -> PreRegisteredProviders {
    PreRegisteredProviders::from_env().unwrap_or_else(|error| {
        tracing::info!(error = ?error, "pre-registered MCP providers are not configured on this host");
        PreRegisteredProviders::empty()
    })
}

/// The PostHog project the rollout flag is read from, or `None` without a
/// project token: nobody is on Macro Connect.
pub fn feature_flags_config(
    api_key: Option<&str>,
    host: Option<&str>,
) -> Option<FeatureFlagsConfig> {
    let api_key = api_key.filter(|key| !key.trim().is_empty())?;
    Some(FeatureFlagsConfig {
        host: host
            .filter(|host| !host.trim().is_empty())
            .unwrap_or(DEFAULT_POSTHOG_HOST)
            .to_owned(),
        api_key: api_key.to_owned(),
    })
}
