#![recursion_limit = "256"]
use crate::api::context::ApiContext;
use ai_tools::{NoOpConnectionService, NoOpNotificationService, NoOpTaskProperties};
use anyhow::Context;
use comms::domain::service::ChannelServiceImpl;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use comms::outbound::postgres::user_repo::PgUserRepo;
use comms_service_client::CommsServiceClient;
use config::{Config, EnvVars, Environment};
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
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsIngressQueue;
use scribe::{ScribeClient, document::DocumentClient};
use search_service_client::SearchServiceClient;
use secretsmanager_client::SecretManager;
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use sqlx::postgres::PgPoolOptions;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use stream::outbound::redis_pg::RedisPostgresStreamRepo;
use sync_service_client::SyncServiceClient;

mod api;
mod config;
mod core;
mod model;
mod service;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env(EnvVars::unwrap_new())
        .context("failed to parse config from environment")?;

    tracing::info!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 30),
        Environment::Develop => (3, 20),
        Environment::Local => (3, 10),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.database_url)
        .await
        .context("failed to connect to macrodb")?;

    tracing::info!(
        min_connections,
        max_connections,
        "initialized db connection"
    );

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let dynamodb_client = aws_sdk_dynamodb::Client::new(&aws_config);
    let queue_aws_client = aws_sdk_sqs::Client::new(&aws_config);

    let sqs_client = sqs_client::SQS::new(queue_aws_client)
        .document_text_extractor_queue(&config.document_text_extractor_queue)
        .chat_delete_queue(&config.chat_delete_queue)
        .email_scheduled_queue(&config.email_scheduled_queue)
        .search_event_queue(&config.search_event_queue);

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let internal_auth_key = secretsmanager_client::LocalOrRemoteSecret::Local(
        InternalApiSecretKey::new().context("failed to create internal auth key")?,
    );

    let document_storage_client = DocumentStorageServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.document_storage_service_url.clone(),
    );

    tracing::info!("initialized dss client");
    // Comms service is now served from document_storage_service under /comms prefix
    let comms_service_client = CommsServiceClient::new(config.document_storage_service_url.clone());

    tracing::info!("initialized comms client");
    let sync_service_auth_key = match config.environment {
        Environment::Local => config.sync_service_auth_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.sync_service_auth_key)
            .await
            .context("failed to get sync service auth key from secrets manager")?
            .to_string(),
    };

    let sync_service_client = SyncServiceClient::new(
        sync_service_auth_key.clone(),
        config.sync_service_url.clone(),
    );

    tracing::info!("initialized sync service client");
    let search_service_client = SearchServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.document_storage_service_url.clone(),
    );

    tracing::info!("initialized search service client");

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await
            .context("failed to create jwt validation args")?;

    let lexical_client = Arc::new(lexical_client::LexicalClient::new(
        sync_service_auth_key,
        config.lexical_service_url.clone(),
    ));

    let email_service_client = Arc::new(EmailServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.email_service_url.clone(),
    ));

    let static_file_service_client = Arc::new(StaticFileServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.static_file_service_url.clone(),
    ));

    tracing::info!("initialized static file service client");

    // Build soup service
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
    ));

    tracing::info!("initialized soup service");

    // Initialize Redis client for stream service
    let redis_client = Arc::new(
        redis::Client::open(config.redis_host.as_ref())
            .inspect(|client| {
                client
                    .get_connection()
                    .map(|_| tracing::trace!("initialized redis connection"))
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "failed to connect to redis");
                    })
                    .expect("redis connetion required");
            })
            .context("failed to connect to redis")?,
    );
    let stream_repo = RedisPostgresStreamRepo::new((*redis_client).clone(), db.clone()).obj();

    tracing::info!("initialized stream repo");

    let connection_manager =
        connection_gateway::service::dynamodb::create_dynamo_db_connection_manager(dynamodb_client)
            .await
            .context("failed to create connection manager")?;

    tracing::info!("initialized connection repo");

    let ingress_queue = SqsIngressQueue {
        client: aws_sdk_sqs::Client::new(&aws_config),
        queue_url: config.notification_queue.clone(),
    };
    let notification_ingress_service = Arc::new(SqsNotificationIngress {
        queue: ingress_queue,
    });

    tracing::info!("initialized notification ingress service");

    // Build document tool context for AI tools
    let s3_client = macro_aws_config::s3_client().await;
    let s3_upload_adapter = S3UploadUrlAdapter::new(
        s3_client,
        config.document_storage_bucket.clone(),
        config.docx_document_upload_bucket.clone(),
    );
    let document_repo = PgDocumentRepo::new(db.clone());
    let cloudfront_private_key = match config.environment {
        Environment::Local => config.cloudfront_signer_private_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.cloudfront_signer_private_key)
            .await
            .context("failed to get CloudFront signer private key from secrets manager")?
            .to_string(),
    };
    let cloudfront_config = CloudFrontConfig {
        distribution_url: config.cloudfront_distribution_url.clone(),
        signer_public_key_id: config.cloudfront_signer_public_key_id.clone(),
        signer_private_key: cloudfront_private_key,
        presigned_url_expiry_seconds: 3600,
        browser_cache_expiry_seconds: 86400,
    };
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

    tracing::info!("initialized document tool context");

    let email_service_client_external = Arc::new(EmailServiceClientExternal::new(
        email_service_client.url().to_owned(),
    ));

    let scribe = Arc::new(
        ScribeClient::new()
            .with_document_client(
                DocumentClient::builder()
                    .with_dss_client(document_storage_client.clone())
                    .with_lexical_client(lexical_client)
                    .with_sync_service_client(sync_service_client.clone())
                    .with_macro_db(db.clone())
                    .build(),
            )
            .with_channel_client(db.clone())
            .with_dcs_client(db.clone())
            .with_email_client(email_service_client)
            .with_static_file_client(static_file_service_client.clone()),
    );
    let search_service_client = Arc::new(search_service_client);

    // Build properties tool context for AI tools
    let properties_service = properties::PropertiesServiceImpl::new(
        properties::PropertiesPgRepo::new(db.clone()),
        Some(properties::PermissionServiceImpl::new(db.clone())),
        Some(NoOpNotificationService),
    );
    let properties_tool_context =
        properties::inbound::toolset::PropertiesToolContext::new(properties_service);

    tracing::info!("initialized properties tool context");

    // Build email tool context for AI tools
    let email_tool_context = email::inbound::toolset::EmailToolContext::new(
        Arc::new(EmailServiceImpl::new(
            EmailPgRepo::new(db.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db.clone())),
            sqs_client.clone(),
            0,
        )),
        Arc::new(email::domain::ports::NoOpGmailTokenProvider),
        Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            db.clone(),
        ))),
    );

    tracing::info!("initialized email tool context");

    // Build shared tool context and toolset
    let tool_service_context = ai_tools::ToolServiceContext {
        search_service_client: search_service_client.clone(),
        email_service_client: email_service_client_external.clone(),
        scribe: scribe.clone(),
        soup_service: soup_service.clone(),
        email_service: email_service_for_tools.clone(),
        document_tool_context: document_tool_context.clone(),
        properties_tool_context: properties_tool_context.clone(),
        email_tool_context: email_tool_context.clone(),
    };
    let all_tools = ai_tools::all_tools();
    let all_tools_toolset = all_tools.toolset.clone();
    let all_tools_prompt = all_tools.prompt;

    // Build memory service
    let memory_repo = memory::outbound::pg_memory_repo::PgMemoryRepo::new(db.clone());
    let memory_service = Arc::new(memory::domain::service::MemoryServiceImpl::new(
        db.clone(),
        memory_repo,
        tool_service_context.clone(),
        all_tools,
    ));

    tracing::info!("initialized memory service");

    api::setup_and_serve(ApiContext {
        db: db.clone(),
        email_service_client_external,
        scribe,
        sqs_client: Arc::new(sqs_client),
        document_storage_client: Arc::new(document_storage_client),
        comms_service_client: Arc::new(comms_service_client),
        search_service_client,
        jwt_args,
        config: Arc::new(config),
        internal_auth_key,
        notification_ingress_service,
        connection_repo: connection_manager.persistence,
        soup_service,
        email_service: email_service_for_tools,
        stream_repo,
        document_tool_context,
        memory_service,
        properties_tool_context,
        email_tool_context: email_tool_context.clone(),
        tool_service_context,
        all_tools: all_tools_toolset,
        all_tools_prompt,
    })
    .await
    .context("failed to setup and serve api")?;
    Ok(())
}
