use crate::config::Config;
use axum::extract::FromRef;
use document_storage_service_client::DocumentStorageServiceClient;
use insight_service_client::InsightContextProvider;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use scribe::{
    ScribeClient, channel::ChannelClient, dcs::DcsClient, document::DocumentClient,
    email::EmailClient, static_file::StaticFileClient,
};
use search_service_client::SearchServiceClient;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::{Arc, OnceLock};

pub type DcsScribe =
    ScribeClient<DocumentClient, ChannelClient, DcsClient, EmailClient, StaticFileClient>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub db: PgPool,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub document_storage_client: Arc<DocumentStorageServiceClient>,
    pub macro_notify_client: Arc<macro_notify::MacroNotify>,
    pub comms_service_client: Arc<comms_service_client::CommsServiceClient>,
    pub context_provider_client: Arc<InsightContextProvider>,
    pub search_service_client: Arc<SearchServiceClient>,
    pub scribe: Arc<DcsScribe>,
    pub metering_client: Arc<metering_service_client::Client>,
    pub email_service_client_external: Arc<email_service_client::EmailServiceClientExternal>,
    pub jwt_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
}

pub static GLOBAL_CONTEXT: OnceLock<ApiContext> = OnceLock::new();

#[cfg(test)]
pub async fn test_api_context(pool: sqlx::Pool<sqlx::Postgres>) -> std::sync::Arc<ApiContext> {
    use aws_sdk_sqs;
    use comms_service_client::CommsServiceClient;
    use document_cognition_service_client::DocumentCognitionServiceClient;
    use document_storage_service_client::DocumentStorageServiceClient;
    use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
    use insight_service_client::InsightContextProvider;
    use lexical_client::LexicalClient;
    use macro_notify::MacroNotifyClient;
    use metering_service_client::Client as MeteringClient;
    use scribe::ScribeClient;
    use search_service_client::SearchServiceClient;
    use sqs_client::SQS;
    use static_file_service_client::StaticFileServiceClient;
    use std::sync::Arc;
    use sync_service_client::SyncServiceClient;

    let sqs_config = aws_sdk_sqs::Config::builder()
        .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
        .build();
    let aws_sqs_client = aws_sdk_sqs::Client::from_conf(sqs_config);
    let sqs_client = SQS::new(aws_sqs_client);

    let document_storage_client = Arc::new(DocumentStorageServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));
    let macro_notify_client =
        MacroNotifyClient::new("dummy_queue".into(), "dummy_service".into()).await;
    let comms_service_client = Arc::new(CommsServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));
    let context_provider_client = InsightContextProvider::create(sqs_client.clone(), "dummy");
    let search_service_client =
        SearchServiceClient::new("dummy_auth_key".into(), "http://localhost".into());
    let lexical_client = Arc::new(LexicalClient::new(
        "test".into(),
        "http://nofileshere".into(),
    ));
    let sync_service_client = Arc::new(SyncServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));
    let email_service_client = Arc::new(EmailServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));
    let document_cognition_service_client = Arc::new(DocumentCognitionServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));
    let static_file_service_client = Arc::new(StaticFileServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));

    let email_service_client_external = Arc::new(EmailServiceClientExternal::new(
        email_service_client.url().to_owned(),
    ));

    let content_client = ScribeClient::new()
        .with_document_client(
            DocumentClient::builder()
                .with_dss_client(document_storage_client.clone())
                .with_lexical_client(lexical_client)
                .with_sync_service_client(sync_service_client)
                .build(),
        )
        .with_channel_client(comms_service_client.clone())
        .with_dcs_client(document_cognition_service_client)
        .with_email_client(email_service_client)
        .with_static_file_client(static_file_service_client.clone());

    let metering_client =
        MeteringClient::new("dummy_auth_key".into(), "http://localhost".into(), false).unwrap();

    let api_context = ApiContext {
        db: pool.clone(),
        sqs_client: Arc::new(sqs_client),
        document_storage_client,
        macro_notify_client: Arc::new(macro_notify_client),
        comms_service_client,
        context_provider_client: Arc::new(context_provider_client),
        search_service_client: Arc::new(search_service_client),
        scribe: Arc::new(content_client),
        metering_client: Arc::new(metering_client),
        email_service_client_external,
        jwt_args: JwtValidationArgs::new_testing(),
        config: Arc::new(Config::new_empty_for_test()),
        internal_auth_key: LocalOrRemoteSecret::Local(InternalApiSecretKey::Comptime("testing")),
    };
    Arc::new(api_context)
}
