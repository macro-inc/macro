//! MCP server binary that serves the DCS AI toolset over HTTP.
//!
//! This binary spins up a Streamable HTTP MCP server exposing the same
//! tools that are available in the DCS chat/stream API, with OAuth 2.1
//! authentication backed by FusionAuth.

use ai_tools::{
    NoOpConnectionService, NoOpNotificationService, NoOpTaskProperties, ToolServiceContext,
};
use anyhow::Context;
use comms::domain::service::ChannelServiceImpl;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use comms::outbound::postgres::user_repo::PgUserRepo;
use dashmap::DashMap;
use document_cognition_service::mcp_oauth::{
    mcp_router, state::OAuthState, tool_service::AuthenticatedToolService,
};
use document_storage_service_client::DocumentStorageServiceClient;
use documents::{
    domain::{models::CloudFrontConfig, service::DocumentServiceImpl},
    inbound::toolset::DocumentToolContext,
    outbound::{pg_document_repo::PgDocumentRepo, s3_upload_url::S3UploadUrlAdapter},
};
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use scribe::{ScribeClient, document::DocumentClient};
use search_service_client::SearchServiceClient;
use secretsmanager_client::SecretManager;
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

env_var!(
    struct McpEnvVars {
        DatabaseUrl,
        DocumentStorageServiceUrl,
        SyncServiceUrl,
        SyncServiceAuthKey,
        LexicalServiceUrl,
        EmailServiceUrl,
        StaticFileServiceUrl,
        DocumentStorageBucket,
        DocxDocumentUploadBucket,
        DocumentStorageServiceCloudfrontDistributionUrl,
        DocumentStorageServiceCloudfrontSignerPublicKeyId,
        DocumentStorageServiceCloudfrontSignerPrivateKeySecretName,
        McpPublicUrl,
        FusionauthBaseUrl,
        FusionauthClientId,
        FusionauthTenantId,
        FusionauthApiKeySecretKey,
        GoogleClientId,
        GoogleClientSecretKey,
    }
);

fn is_local() -> bool {
    matches!(
        macro_env::Environment::new_or_prod(),
        macro_env::Environment::Local
    )
}

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let env_vars = McpEnvVars::new().context("failed to load environment variables")?;

    // FusionAuth client secret uses a different env var name in local vs deployed
    let fusionauth_client_secret_env = if is_local() {
        std::env::var("FUSIONAUTH_CLIENT_SECRET")
            .context("FUSIONAUTH_CLIENT_SECRET must be provided")?
    } else {
        std::env::var("FUSIONAUTH_CLIENT_SECRET_KEY")
            .context("FUSIONAUTH_CLIENT_SECRET_KEY must be provided")?
    };

    let db = PgPoolOptions::new()
        .min_connections(3)
        .max_connections(10)
        .connect(&env_vars.database_url)
        .await
        .context("failed to connect to macrodb")?;

    tracing::info!("initialized db connection");

    let macro_env = macro_env::Environment::new_or_prod();
    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    // JWT validation args (reads JWT_SECRET_KEY, AUDIENCE, ISSUER, etc. from env)
    let jwt_args = JwtValidationArgs::new_with_secret_manager(macro_env, &secretsmanager_client)
        .await
        .context("failed to initialize JWT validation args")?;

    let internal_auth_key = secretsmanager_client::LocalOrRemoteSecret::Local(
        InternalApiSecretKey::new().context("failed to create internal auth key")?,
    );

    let dss_url: String = env_vars.document_storage_service_url.as_ref().to_owned();

    let document_storage_client =
        DocumentStorageServiceClient::new(internal_auth_key.as_ref().to_string(), dss_url.clone());

    let sync_service_auth_key = if is_local() {
        env_vars.sync_service_auth_key.as_ref().to_owned()
    } else {
        secretsmanager_client
            .get_secret_value(&env_vars.sync_service_auth_key)
            .await
            .context("failed to get sync service auth key from secrets manager")?
            .to_string()
    };

    let search_service_client =
        SearchServiceClient::new(internal_auth_key.as_ref().to_string(), dss_url);

    let lexical_client = Arc::new(lexical_client::LexicalClient::new(
        sync_service_auth_key.clone(),
        env_vars.lexical_service_url.as_ref().to_owned(),
    ));

    let email_service_client = Arc::new(EmailServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        env_vars.email_service_url.as_ref().to_owned(),
    ));

    let static_file_service_client =
        Arc::new(static_file_service_client::StaticFileServiceClient::new(
            internal_auth_key.as_ref().to_string(),
            env_vars.static_file_service_url.as_ref().to_owned(),
        ));

    // Build soup service
    let frecency_storage = FrecencyPgStorage::new(db.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(db.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        email::domain::ports::NoOpGmailLabelModifier,
        0,
    );
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo { pool: db.clone() },
        PgUserRepo::new(db.clone()),
        frecency_storage,
    );
    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(db.clone()),
        frecency_service,
        email_service,
        channels_service,
    ));

    // Build document tool context
    let s3_client = macro_aws_config::s3_client().await;
    let s3_upload_adapter = S3UploadUrlAdapter::new(
        s3_client,
        env_vars.document_storage_bucket.as_ref(),
        env_vars.docx_document_upload_bucket.as_ref(),
    );
    let document_repo = PgDocumentRepo::new(db.clone());
    let cloudfront_private_key = if is_local() {
        env_vars
            .document_storage_service_cloudfront_signer_private_key_secret_name
            .as_ref()
            .to_owned()
    } else {
        secretsmanager_client
            .get_secret_value(
                &env_vars.document_storage_service_cloudfront_signer_private_key_secret_name,
            )
            .await
            .context("failed to get CloudFront signer private key from secrets manager")?
            .to_string()
    };
    let cloudfront_config = CloudFrontConfig {
        distribution_url: env_vars
            .document_storage_service_cloudfront_distribution_url
            .as_ref()
            .to_owned(),
        signer_public_key_id: env_vars
            .document_storage_service_cloudfront_signer_public_key_id
            .as_ref()
            .to_owned(),
        signer_private_key: cloudfront_private_key,
        presigned_url_expiry_seconds: 3600,
        browser_cache_expiry_seconds: 86400,
    };
    let sync_service_url: String = env_vars.sync_service_url.as_ref().to_owned();
    let sync_service_client =
        SyncServiceClient::new(sync_service_auth_key.clone(), sync_service_url.clone());
    let document_service = DocumentServiceImpl::new(
        document_repo,
        cloudfront_config,
        sync_service_client.clone(),
        s3_upload_adapter,
        NoOpTaskProperties,
        NoOpConnectionService,
    );
    let entity_access_service = EntityAccessServiceImpl::new(PgAccessRepository::new(db.clone()));
    let lexical_client_for_tools = (*lexical_client).clone();
    let document_tool_context = DocumentToolContext::new(
        document_service,
        entity_access_service,
        lexical_client_for_tools,
    );

    // Build properties tool context
    let properties_service = properties::PropertiesServiceImpl::new(
        properties::PropertiesPgRepo::new(db.clone()),
        Some(properties::PermissionServiceImpl::new(db.clone())),
        Some(NoOpNotificationService),
    );
    let properties_tool_context =
        properties::inbound::toolset::PropertiesToolContext::new(properties_service);

    // Build the ToolServiceContext
    let tool_context = ToolServiceContext {
        email_service_client: Arc::new(EmailServiceClientExternal::new(
            email_service_client.url().to_owned(),
        )),
        search_service_client: Arc::new(search_service_client),
        scribe: Arc::new(
            ScribeClient::new()
                .with_document_client(
                    DocumentClient::builder()
                        .with_dss_client(document_storage_client)
                        .with_lexical_client(lexical_client)
                        .with_sync_service_client(SyncServiceClient::new(
                            sync_service_auth_key,
                            sync_service_url,
                        ))
                        .with_macro_db(db.clone())
                        .build(),
                )
                .with_channel_client(db.clone())
                .with_dcs_client(db.clone())
                .with_email_client(email_service_client)
                .with_static_file_client(static_file_service_client),
        ),
        soup_service,
        document_tool_context,
        properties_tool_context,
    };

    tracing::info!("initialized tool context");

    // Create the MCP service with authenticated tool handler
    let mcp_service = StreamableHttpService::new(
        move || {
            let tools = ai_tools::all_tools();
            Ok(AuthenticatedToolService::new(
                tools.toolset,
                tool_context.clone(),
            ))
        },
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    );

    // Build FusionAuth client for the MCP OAuth flow.
    // The oauth_redirect_uri points to the MCP server's own callback endpoint.
    let mcp_public_url: String = env_vars.mcp_public_url.as_ref().to_owned();
    let mcp_oauth_redirect_uri = format!("{mcp_public_url}/oauth/callback");

    let fusionauth_api_key = if is_local() {
        env_vars.fusionauth_api_key_secret_key.as_ref().to_owned()
    } else {
        secretsmanager_client
            .get_secret_value(&env_vars.fusionauth_api_key_secret_key)
            .await
            .context("failed to get FusionAuth API key")?
            .to_string()
    };

    let fusionauth_client_secret = if is_local() {
        fusionauth_client_secret_env
    } else {
        secretsmanager_client
            .get_secret_value(&fusionauth_client_secret_env)
            .await
            .context("failed to get FusionAuth client secret")?
            .to_string()
    };

    let google_client_secret = if is_local() {
        env_vars.google_client_secret_key.as_ref().to_owned()
    } else {
        secretsmanager_client
            .get_secret_value(&env_vars.google_client_secret_key)
            .await
            .context("failed to get Google client secret")?
            .to_string()
    };

    let fusionauth_client = fusionauth::FusionAuthClient::new(
        env_vars.fusionauth_tenant_id.as_ref().to_owned(),
        fusionauth_api_key,
        env_vars.fusionauth_client_id.as_ref().to_owned(),
        fusionauth_client_secret,
        env_vars.fusionauth_base_url.as_ref().to_owned(),
        mcp_oauth_redirect_uri,
        env_vars.google_client_id.as_ref().to_owned(),
        google_client_secret,
    );

    // Resolve the Google IDP ID at startup so we don't need it as an env var.
    let google_idp_id = fusionauth_client
        .get_identity_provider_id_by_name("google")
        .await
        .context("failed to look up Google identity provider in FusionAuth")?;
    tracing::info!(%google_idp_id, "resolved Google IDP ID from FusionAuth");

    // Build OAuth state
    let oauth_state = OAuthState {
        pending: Arc::new(DashMap::new()),
        codes: Arc::new(DashMap::new()),
        jwt_args: jwt_args.clone(),
        fusionauth_client: Arc::new(fusionauth_client),
        google_idp_id,
        mcp_public_url: mcp_public_url.clone(),
    };

    // Spawn background cleanup for expired OAuth entries
    let cleanup_state = oauth_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            cleanup_state.cleanup_expired();
        }
    });

    let app = mcp_router(oauth_state, jwt_args, mcp_service);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8090".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .context("failed to bind MCP server")?;

    tracing::info!("MCP server listening on http://{addr}/mcp");

    axum::serve(listener, app)
        .await
        .context("MCP server error")?;

    Ok(())
}
