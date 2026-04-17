use std::sync::Arc;

use ai_tools::{
    NoOpConnectionService, NoOpNotificationService, NoOpScheduleContext, NoOpTaskProperties,
    ToolServiceContext,
};
use anyhow::Context;
use comms::domain::service::ChannelServiceImpl;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use comms::outbound::postgres::user_repo::PgUserRepo;
use document_storage_service_client::DocumentStorageServiceClient;
use documents::{
    domain::{models::CloudFrontConfig, service::DocumentServiceImpl},
    inbound::toolset::DocumentToolContext,
    outbound::{pg_document_repo::PgDocumentRepo, s3_upload_url::S3UploadUrlAdapter},
};
use email::domain::ports::ReadonlyEmailPreviewAdapter;
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use mcp_auth_proxy::{
    domain::service::McpAuthProxyServiceImpl,
    outbound::{fusionauth::FusionAuthOAuthProvider, redis::RedisInflightAuth},
};
use scribe::{ScribeClient, document::DocumentClient};
use search_service_client::SearchServiceClient;
use secretsmanager_client::LocalOrRemoteSecret;
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use sqlx::{PgPool, postgres::PgPoolOptions};
use sync_service_client::SyncServiceClient;

env_var!(
    pub struct McpEnvVars {
        DatabaseUrl,
        EmailScheduledQueue,
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
        FusionauthClientSecretKey,
        GoogleClientId,
        GoogleClientSecretKey,
        RedisUrl,
    }
);

#[derive(Clone)]
pub struct McpContext {
    pub jwt_args: JwtValidationArgs,
    pub tool_context: ToolServiceContext,
    pub auth_proxy: McpAuthProxyServiceImpl<RedisInflightAuth>,
}

pub async fn build_context() -> anyhow::Result<McpContext> {
    let env_vars = McpEnvVars::new().context("failed to load environment variables")?;

    let db = PgPoolOptions::new()
        .min_connections(3)
        .max_connections(10)
        .connect(&env_vars.database_url)
        .await
        .context("failed to connect to macrodb")?;

    tracing::info!("initialized db connection");

    let macro_env = macro_env::Environment::new_or_prod();
    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let queue_aws_client = aws_sdk_sqs::Client::new(&aws_config);
    let sqs_client = sqs_client::SQS::new(queue_aws_client)
        .email_scheduled_queue(env_vars.email_scheduled_queue.as_ref());

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let jwt_args = JwtValidationArgs::new_with_secret_manager(macro_env, &secretsmanager_client)
        .await
        .context("failed to initialize JWT validation args")?;

    let internal_auth_key = secretsmanager_client::LocalOrRemoteSecret::Local(
        InternalApiSecretKey::new().context("failed to create internal auth key")?,
    );

    let sync_service_auth_key = LocalOrRemoteSecret::new_from_secret_manager(
        env_vars.sync_service_auth_key.as_ref().to_owned(),
        &secretsmanager_client,
    )
    .await
    .context("failed to load sync service auth key")?;

    let tool_context = build_tool_context(
        &env_vars,
        &db,
        &secretsmanager_client,
        sqs_client,
        internal_auth_key.as_ref().to_string(),
        sync_service_auth_key.as_ref().to_owned(),
    )
    .await?;

    let auth_proxy = build_auth_proxy(&env_vars, &secretsmanager_client).await?;

    Ok(McpContext {
        jwt_args,
        tool_context,
        auth_proxy,
    })
}

async fn build_tool_context(
    env_vars: &McpEnvVars,
    db: &PgPool,
    secretsmanager_client: &secretsmanager_client::SecretsManager,
    sqs_client: sqs_client::SQS,
    internal_auth_key: String,
    sync_service_auth_key: String,
) -> anyhow::Result<ToolServiceContext> {
    let dss_url: String = env_vars.document_storage_service_url.as_ref().to_owned();
    let sync_service_url: String = env_vars.sync_service_url.as_ref().to_owned();

    let document_storage_client =
        DocumentStorageServiceClient::new(internal_auth_key.clone(), dss_url.clone());

    let search_service_client = SearchServiceClient::new(internal_auth_key.clone(), dss_url);

    let lexical_client = Arc::new(lexical_client::LexicalClient::new(
        sync_service_auth_key.clone(),
        env_vars.lexical_service_url.as_ref().to_owned(),
    ));

    let email_service_client = Arc::new(EmailServiceClient::new(
        internal_auth_key.clone(),
        env_vars.email_service_url.as_ref().to_owned(),
    ));

    let static_file_service_client =
        Arc::new(static_file_service_client::StaticFileServiceClient::new(
            internal_auth_key,
            env_vars.static_file_service_url.as_ref().to_owned(),
        ));

    let frecency_storage = FrecencyPgStorage::new(db.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(db.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        0,
    );
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo::new(readonly_pool::ReadOnlyPool(db.clone())),
        PgUserRepo::new(db.clone()),
        frecency_storage,
    );
    let email_service_for_tools: Arc<ai_tools::ToolEmailService> = Arc::new(email_service.clone());
    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(readonly_pool::ReadOnlyPool(db.clone())),
        frecency_service,
        ReadonlyEmailPreviewAdapter(email_service),
        channels_service,
        call::domain::ports::NoOpCallRecordQueryService,
    ));

    let s3_client = macro_aws_config::s3_client().await;
    let s3_upload_adapter = S3UploadUrlAdapter::new(
        s3_client,
        env_vars.document_storage_bucket.as_ref(),
        env_vars.docx_document_upload_bucket.as_ref(),
    );
    let document_repo = PgDocumentRepo::new(db.clone());
    let cloudfront_private_key = LocalOrRemoteSecret::new_from_secret_manager(
        env_vars
            .document_storage_service_cloudfront_signer_private_key_secret_name
            .as_ref()
            .to_owned(),
        secretsmanager_client,
    )
    .await
    .context("failed to load CloudFront signer private key")?;
    let cloudfront_config = CloudFrontConfig {
        distribution_url: env_vars
            .document_storage_service_cloudfront_distribution_url
            .as_ref()
            .to_owned(),
        signer_public_key_id: env_vars
            .document_storage_service_cloudfront_signer_public_key_id
            .as_ref()
            .to_owned(),
        signer_private_key: cloudfront_private_key.as_ref().to_owned(),
        presigned_url_expiry_seconds: 3600,
        browser_cache_expiry_seconds: 86400,
    };
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

    let properties_service = properties::PropertiesServiceImpl::new(
        properties::PropertiesPgRepo::new(db.clone()),
        Some(properties::PermissionServiceImpl::new(
            db.clone(),
            Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
                db.clone(),
            ))),
        )),
        Some(NoOpNotificationService),
    );
    let properties_tool_context =
        properties::inbound::toolset::PropertiesToolContext::new(properties_service);

    let email_tool_context = email::inbound::toolset::EmailToolContext::new(
        Arc::new(EmailServiceImpl::new(
            EmailPgRepo::new(db.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db.clone())),
            sqs_client,
            0,
        )),
        Arc::new(email::domain::ports::NoOpGmailTokenProvider),
        Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            db.clone(),
        ))),
    );

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
        email_service: email_service_for_tools,
        document_tool_context,
        properties_tool_context,
        email_tool_context,
        schedule_tool_context: NoOpScheduleContext,
    };

    tracing::info!("initialized tool context");

    Ok(tool_context)
}

async fn build_auth_proxy(
    env_vars: &McpEnvVars,
    secretsmanager_client: &secretsmanager_client::SecretsManager,
) -> anyhow::Result<McpAuthProxyServiceImpl<RedisInflightAuth>> {
    let mcp_public_url: String = env_vars.mcp_public_url.as_ref().to_owned();
    let mcp_oauth_redirect_uri = format!("{mcp_public_url}/oauth/callback");

    let fusionauth_api_key = LocalOrRemoteSecret::new_from_secret_manager(
        env_vars.fusionauth_api_key_secret_key.as_ref().to_owned(),
        secretsmanager_client,
    )
    .await
    .context("failed to load FusionAuth API key")?;

    let fusionauth_client_secret = LocalOrRemoteSecret::new_from_secret_manager(
        env_vars.fusionauth_client_secret_key.as_ref().to_owned(),
        secretsmanager_client,
    )
    .await
    .context("failed to load FusionAuth client secret")?;

    let google_client_secret = LocalOrRemoteSecret::new_from_secret_manager(
        env_vars.google_client_secret_key.as_ref().to_owned(),
        secretsmanager_client,
    )
    .await
    .context("failed to load Google client secret")?;

    let fusionauth_client = fusionauth::FusionAuthClient::new(
        env_vars.fusionauth_tenant_id.as_ref().to_owned(),
        fusionauth_api_key.as_ref().to_owned(),
        env_vars.fusionauth_client_id.as_ref().to_owned(),
        fusionauth_client_secret.as_ref().to_owned(),
        env_vars.fusionauth_base_url.as_ref().to_owned(),
        mcp_oauth_redirect_uri,
        env_vars.google_client_id.as_ref().to_owned(),
        google_client_secret.as_ref().to_owned(),
    );

    let auth_provider = FusionAuthOAuthProvider::new(fusionauth_client)
        .await
        .context("failed to initialize MCP auth provider")?;
    let redis_client = redis::Client::open(env_vars.redis_url.as_ref().to_owned())
        .context("failed to initialize redis client for MCP auth proxy")?;

    Ok(McpAuthProxyServiceImpl::new(
        mcp_public_url,
        Arc::new(RedisInflightAuth::new(redis_client)),
        Arc::new(auth_provider),
    ))
}
