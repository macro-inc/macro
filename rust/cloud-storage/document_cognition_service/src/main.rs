use crate::api::context::ApiContext;
use anyhow::Context;
use comms::domain::service::ChannelServiceImpl;
use comms::outbound::http::user_repo::UserRepoImpl;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use comms_service_client::CommsServiceClient;
use config::{Config, Environment};
use document_cognition_service_client::DocumentCognitionServiceClient;
use document_storage_service_client::DocumentStorageServiceClient;
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use scribe::{ScribeClient, document::DocumentClient};
use search_service_client::SearchServiceClient;
use secretsmanager_client::SecretManager;
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use sqlx::postgres::PgPoolOptions;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
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
    let config = Config::from_env().context("failed to parse config from environment")?;

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
    let queue_aws_client = aws_sdk_sqs::Client::new(&aws_config);

    let sqs_client = sqs_client::SQS::new(queue_aws_client)
        .document_text_extractor_queue(&config.document_text_extractor_queue)
        .chat_delete_queue(&config.chat_delete_queue)
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

    let document_cognition_service_client = Arc::new(DocumentCognitionServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.document_cognition_service_url.clone(),
    ));

    let static_file_service_client = Arc::new(StaticFileServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.static_file_service_url.clone(),
    ));

    tracing::info!("initialized static file service client");

    // Get auth service secret key for soup service
    let auth_service_secret_key = match config.environment {
        Environment::Local => config.authentication_service_secret_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.authentication_service_secret_key)
            .await
            .context("failed to get auth service secret key from secrets manager")?
            .to_string(),
    };

    // Build soup service
    let frecency_storage = FrecencyPgStorage::new(db.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email_service =
        EmailServiceImpl::new(EmailPgRepo::new(db.clone()), frecency_service.clone());
    let user_repo = UserRepoImpl::new(
        auth_service_secret_key,
        config
            .authentication_service_url
            .parse()
            .context("AUTHENTICATION_SERVICE_URL must be a valid url")?,
    );
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo { pool: db.clone() },
        user_repo,
        frecency_storage,
    );
    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(db.clone()),
        frecency_service,
        email_service,
        channels_service,
    ));

    tracing::info!("initialized soup service");

    api::setup_and_serve(ApiContext {
        db: db.clone(),
        email_service_client_external: Arc::new(EmailServiceClientExternal::new(
            email_service_client.url().to_owned(),
        )),
        scribe: Arc::new(
            ScribeClient::new()
                .with_document_client(
                    DocumentClient::builder()
                        .with_dss_client(document_storage_client.clone())
                        .with_lexical_client(lexical_client)
                        .with_sync_service_client(sync_service_client.clone())
                        .with_macro_db(db.clone())
                        .build(),
                )
                .with_channel_client_and_db(comms_service_client.clone(), db.clone())
                .with_dcs_client(document_cognition_service_client)
                .with_email_client(email_service_client)
                .with_static_file_client(static_file_service_client.clone()),
        ),
        sqs_client: Arc::new(sqs_client),
        document_storage_client: Arc::new(document_storage_client),
        comms_service_client: Arc::new(comms_service_client),
        search_service_client: Arc::new(search_service_client),
        jwt_args,
        config: Arc::new(config),
        internal_auth_key,
        soup_service,
    })
    .await
    .context("failed to setup and serve api")?;
    Ok(())
}
