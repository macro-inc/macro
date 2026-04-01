use super::*;
use connection_gateway::model::connection::StoredConnectionEntity;
use connection_gateway::model::tracking::{EntityConnection, UserEntityConnection};
use connection_gateway::service::connection::ConnectionRepo;
use std::sync::Arc;
use stream::domain::{
    ItemId, ItemStream, Result as StreamResult, StreamEvent, StreamId, StreamRepo,
};
use tokio::sync::broadcast::{self, Receiver};

pub struct MockConnectionRepo;

impl MockConnectionRepo {
    pub fn new() -> Arc<dyn ConnectionRepo> {
        Arc::new(Self)
    }
}

#[async_trait::async_trait]
impl ConnectionRepo for MockConnectionRepo {
    async fn insert_connection_entry(
        &self,
        _connection: UserEntityConnection<'_>,
    ) -> anyhow::Result<StoredConnectionEntity> {
        unimplemented!()
    }
    async fn get_entries_by_entity(
        &self,
        _entity: &model_entity::Entity<'_>,
    ) -> anyhow::Result<Vec<StoredConnectionEntity>> {
        Ok(vec![])
    }
    async fn get_entries_by_connection_id(
        &self,
        _connection_id: &str,
    ) -> anyhow::Result<Vec<StoredConnectionEntity>> {
        Ok(vec![])
    }
    async fn get_connection(&self, _connection_id: &str) -> anyhow::Result<StoredConnectionEntity> {
        unimplemented!()
    }
    async fn get_entry_for_connection_entity(
        &self,
        _entity: EntityConnection<'_>,
    ) -> anyhow::Result<Option<StoredConnectionEntity>> {
        Ok(None)
    }
    async fn remove_all_entries_for_by_connection_id(
        &self,
        _connection_id: &str,
    ) -> anyhow::Result<()> {
        Ok(())
    }
    async fn remove_entity(&self, _entity: &EntityConnection<'_>) -> anyhow::Result<()> {
        Ok(())
    }
    async fn update_last_entity_ping(
        &self,
        _entity: &EntityConnection<'_>,
        _timestamp: u64,
    ) -> anyhow::Result<StoredConnectionEntity> {
        unimplemented!()
    }
    async fn update_user_connection_last_ping(
        &self,
        _connection_id: &str,
        _user: &str,
        _timestamp: u64,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

/// Mock StreamRepo for testing - does nothing but satisfies the interface
pub struct MockStreamRepo {
    tx: broadcast::Sender<StreamEvent>,
}

impl MockStreamRepo {
    pub fn new() -> Arc<dyn StreamRepo> {
        let (tx, _) = broadcast::channel(16);
        Arc::new(Self { tx })
    }
}

#[async_trait::async_trait]
impl StreamRepo for MockStreamRepo {
    async fn append(&self, _id: &StreamId, _payload: serde_json::Value) -> StreamResult<ItemId> {
        Ok("mock-item-id".to_string())
    }

    async fn stream_from_beginning(&self, _id: &StreamId) -> StreamResult<ItemStream> {
        Ok(Box::pin(futures::stream::empty()))
    }

    async fn close(&self, _id: &StreamId) -> StreamResult<()> {
        Ok(())
    }

    async fn active_streams(&self, _entity_id: &str) -> StreamResult<Vec<StreamId>> {
        Ok(vec![])
    }

    async fn notify(&self) -> Receiver<StreamEvent> {
        self.tx.subscribe()
    }
}

pub async fn test_api_context(pool: sqlx::Pool<sqlx::Postgres>) -> std::sync::Arc<ApiContext> {
    use aws_sdk_sqs;
    use comms::domain::service::ChannelServiceImpl;
    use comms::outbound::postgres::comms_repo::PgCommsRepo;
    use comms::outbound::postgres::user_repo::PgUserRepo;
    use comms_service_client::CommsServiceClient;
    use document_cognition_service_client::DocumentCognitionServiceClient;
    use document_storage_service_client::DocumentStorageServiceClient;
    use email::domain::ports::ReadonlyEmailPreviewAdapter;
    use email::domain::service::EmailServiceImpl;
    use email::outbound::EmailPgRepo;
    use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
    use frecency::domain::services::FrecencyQueryServiceImpl;
    use frecency::outbound::postgres::FrecencyPgStorage;
    use lexical_client::LexicalClient;
    use notification::domain::service::SqsNotificationIngress;
    use notification::outbound::queue::SqsIngressQueue;
    use scribe::ScribeClient;
    use search_service_client::SearchServiceClient;
    use soup::domain::service::SoupImpl;
    use soup::outbound::pg_soup_repo::PgSoupRepo;
    use sqs_client::SQS;
    use static_file_service_client::StaticFileServiceClient;
    use sync_service_client::SyncServiceClient;

    let sqs_config = aws_sdk_sqs::Config::builder()
        .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
        .build();
    let aws_sqs_client = aws_sdk_sqs::Client::from_conf(sqs_config.clone());
    let sqs_client = SQS::new(aws_sqs_client);

    let document_storage_client = Arc::new(DocumentStorageServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));
    let comms_service_client = Arc::new(CommsServiceClient::new("http://localhost".into()));
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
                .with_sync_service_client(sync_service_client.clone())
                .with_macro_db(pool.clone())
                .build(),
        )
        .with_channel_client(pool.clone())
        .with_dcs_client(pool.clone())
        .with_email_client(email_service_client)
        .with_static_file_client(static_file_service_client.clone());

    // Build soup service dependencies
    let frecency_storage = FrecencyPgStorage::new(pool.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(pool.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        email::domain::ports::NoOpGmailLabelModifier,
        0,
    );
    let user_repo = PgUserRepo::new(pool.clone());
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo::new(readonly_pool::ReadOnlyPool(pool.clone())),
        user_repo,
        frecency_storage,
    );
    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(readonly_pool::ReadOnlyPool(pool.clone())),
        frecency_service,
        ReadonlyEmailPreviewAdapter(email_service),
        channels_service,
    ));

    let ingress_queue = SqsIngressQueue {
        client: aws_sdk_sqs::Client::from_conf(sqs_config),
        queue_url: "test-notification-ingress-queue".to_string(),
    };
    let notification_ingress_service = Arc::new(SqsNotificationIngress {
        queue: ingress_queue,
    });

    // Build document tool context for AI tools
    let s3_config = aws_sdk_s3::Config::builder()
        .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
        .build();
    let s3_client = aws_sdk_s3::Client::from_conf(s3_config);
    let s3_upload_adapter = documents::outbound::s3_upload_url::S3UploadUrlAdapter::new(
        s3_client,
        "test-bucket",
        "test-docx-bucket",
    );
    let document_repo = documents::outbound::pg_document_repo::PgDocumentRepo::new(pool.clone());
    let cloudfront_config = documents::domain::models::CloudFrontConfig {
        distribution_url: "https://test.cloudfront.net".to_string(),
        signer_public_key_id: "test-key-id".to_string(),
        signer_private_key: "test-private-key".to_string(),
        presigned_url_expiry_seconds: 3600,
        browser_cache_expiry_seconds: 86400,
    };
    let document_service = documents::domain::service::DocumentServiceImpl::new(
        document_repo,
        cloudfront_config,
        sync_service_client.as_ref().clone(),
        s3_upload_adapter,
        ai_tools::NoOpTaskProperties,
        ai_tools::NoOpConnectionService,
    );
    let entity_access_service = entity_access::domain::service::EntityAccessServiceImpl::new(
        entity_access::outbound::PgAccessRepository::new(pool.clone()),
    );
    let test_lexical_client = LexicalClient::new("test".into(), "http://nofileshere".into());
    let document_tool_context = documents::inbound::toolset::DocumentToolContext::new(
        document_service,
        entity_access_service,
        test_lexical_client,
    );

    let search_service_client = Arc::new(search_service_client);
    let scribe = Arc::new(content_client);

    // Build properties tool context
    let properties_service = properties::PropertiesServiceImpl::new(
        properties::PropertiesPgRepo::new(pool.clone()),
        Some(properties::PermissionServiceImpl::new(pool.clone())),
        Some(ai_tools::NoOpNotificationService),
    );
    let properties_tool_context =
        properties::inbound::toolset::PropertiesToolContext::new(properties_service);

    let memory_tool_context = ai_tools::ToolServiceContext {
        search_service_client: search_service_client.clone(),
        email_service_client: email_service_client_external.clone(),
        scribe: scribe.clone(),
        soup_service: soup_service.clone(),
        document_tool_context: document_tool_context.clone(),
        properties_tool_context: properties_tool_context.clone(),
    };
    let memory_repo = memory::outbound::pg_memory_repo::PgMemoryRepo::new(pool.clone());
    let memory_service = Arc::new(memory::domain::service::MemoryServiceImpl::new(
        pool.clone(),
        memory_repo,
        memory_tool_context,
        ai_tools::all_tools(),
    ));

    let api_context = ApiContext {
        db: pool.clone(),
        sqs_client: Arc::new(sqs_client),
        document_storage_client,
        comms_service_client,
        search_service_client,
        scribe,
        email_service_client_external,
        jwt_args: JwtValidationArgs::new_testing(),
        config: Arc::new(Config::new_empty_for_test()),
        internal_auth_key: LocalOrRemoteSecret::Local(InternalApiSecretKey::Comptime("testing")),
        notification_ingress_service,
        connection_repo: MockConnectionRepo::new(),
        soup_service,
        stream_repo: MockStreamRepo::new(),
        document_tool_context,
        memory_service,
        properties_tool_context,
    };
    Arc::new(api_context)
}
