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
    use document_storage_service_client::DocumentStorageServiceClient;
    use email::domain::ports::ReadonlyEmailPreviewAdapter;
    use email::domain::service::EmailServiceImpl;
    use email::outbound::EmailPgRepo;
    use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
    use frecency::domain::services::FrecencyQueryServiceImpl;
    use frecency::outbound::postgres::FrecencyPgStorage;
    use lexical_client::LexicalClient;
    use notification::domain::service::{
        NotificationReaderService, PlatformArnConfig, SqsNotificationIngress,
    };
    use notification::outbound::queue::SqsQueue;
    use notification::outbound::repository::DbNotificationRepository;
    use search_service_client::SearchServiceClient;
    use soup::domain::service::SoupImpl;
    use soup::outbound::pg_soup_repo::PgSoupRepo;
    use sqs_client::SQS;
    use sync_service_client::SyncServiceClient;

    let sqs_config = aws_sdk_sqs::Config::builder()
        .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
        .build();
    let aws_sqs_client = aws_sdk_sqs::Client::from_conf(sqs_config.clone());
    let sqs_client = SQS::new(aws_sqs_client).email_scheduled_queue("test-email-scheduled-queue");

    let document_storage_client = Arc::new(DocumentStorageServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));
    let comms_service_client = Arc::new(CommsServiceClient::new("http://localhost".into()));
    let search_service_client =
        SearchServiceClient::new("dummy_auth_key".into(), "http://localhost".into());
    let sync_service_client = Arc::new(SyncServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));
    let email_service_client = Arc::new(EmailServiceClient::new(
        "dummy_auth_key".into(),
        "http://localhost".into(),
    ));
    let email_service_client_external = Arc::new(EmailServiceClientExternal::new(
        email_service_client.url().to_owned(),
    ));

    // Build soup service dependencies
    let frecency_storage = FrecencyPgStorage::new(pool.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let crm_service = crm::domain::service::CrmServiceImpl::new(
        crm::outbound::companies_repo::CompaniesRepositoryImpl::new(pool.clone()),
        crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
    );
    let email_service = EmailServiceImpl::new(
        EmailPgRepo::new(pool.clone()),
        frecency_service.clone(),
        email::domain::ports::NoOpEnqueuer,
        crm_service.clone(),
        0,
    );
    let user_repo = PgUserRepo::new(pool.clone());
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo::new(readonly_pool::ReadOnlyPool(pool.clone())),
        user_repo,
        frecency_storage,
    );
    let email_service_for_tools: Arc<ai_tools::ToolEmailService> = Arc::new(email_service.clone());
    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(readonly_pool::ReadOnlyPool(pool.clone())),
        frecency_service,
        ReadonlyEmailPreviewAdapter(email_service),
        channels_service,
        call::domain::ports::NoOpCallRecordQueryService,
    ));

    let ingress_queue = SqsQueue::new(
        aws_sdk_sqs::Client::from_conf(sqs_config.clone()),
        "test-notification-ingress-queue".to_string(),
    );
    let notification_ingress_service = Arc::new(SqsNotificationIngress {
        queue: ingress_queue,
    });

    let notification_reader_queue = SqsQueue::new(
        aws_sdk_sqs::Client::from_conf(sqs_config),
        "test-notification-queue".to_string(),
    );
    let notification_reader_service = NotificationReaderService {
        repository: DbNotificationRepository::new(pool.clone()),
        queue: ai_tools::ToolNotificationQueue::Sqs(notification_reader_queue),
        sns_endpoint: ai_tools::NoOpSnsEndpointManager,
        platform_config: PlatformArnConfig {
            apns_platform_arn: String::new(),
            fcm_platform_arn: String::new(),
            apns_voip_platform_arn: String::new(),
        },
        realtime: notification::domain::ports::NoopNotificationRealtimePublisher,
    };
    let notification_tool_context =
        notification::inbound::ai_tool::NotificationToolContext::new(notification_reader_service);

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
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(pool.clone()),
        ),
    );
    let entity_access_service = Arc::new(
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool.clone()),
        ),
    );
    let test_lexical_client = LexicalClient::new("test".into(), "http://nofileshere".into());
    let document_tool_context = documents::inbound::toolset::DocumentToolContext::new(
        document_service,
        (*entity_access_service).clone(),
        test_lexical_client,
        sync_service_client.as_ref().clone(),
    );

    let search_service_client = Arc::new(search_service_client);

    // Build properties tool context
    let properties_service = properties::PropertiesServiceImpl::new(
        properties::PropertiesPgRepo::new(pool.clone()),
        Some(properties::PermissionServiceImpl::new(
            pool.clone(),
            entity_access_service.clone(),
        )),
        Some(ai_tools::NoOpNotificationService),
    );
    let properties_tool_context =
        properties::inbound::toolset::PropertiesToolContext::new(properties_service);

    let email_tool_context = email::inbound::toolset::EmailToolContext::new(
        Arc::new(email::domain::service::EmailServiceImpl::new(
            email::outbound::EmailPgRepo::new(pool.clone()),
            frecency::domain::services::FrecencyQueryServiceImpl::new(
                frecency::outbound::postgres::FrecencyPgStorage::new(pool.clone()),
            ),
            sqs_client.clone(),
            crm_service.clone(),
            0,
        )),
        Arc::new(email::domain::ports::NoOpGmailTokenProvider),
        entity_access_service.clone(),
    );

    let call_service = call::domain::service::CallServiceImpl::new(
        call::outbound::pg_call_repo::PgCallRepo::new(pool.clone()),
        ai_tools::NoOpCallRtcClient,
        ai_tools::NoOpConnectionService,
        (*entity_access_service).clone(),
        ai_tools::NoOpNotificationIngress,
        None::<call::outbound::s3_recording_storage::S3RecordingStorage>,
        String::new(),
    );
    let call_query_service = call::domain::service::CallRecordQueryServiceImpl::new(
        call::outbound::pg_call_repo::PgCallRepo::new(pool.clone()),
    );
    let call_tool_context = call::inbound::toolset::CallToolContext::new(
        call_service,
        call_query_service,
        (*entity_access_service).clone(),
    );

    let chat_tool_context = chat::inbound::toolset::ChatToolContext::new(
        chat::domain::service::ChatServiceImpl::new(
            chat::outbound::postgres::PgChatRepo::new(pool.clone()),
            Arc::new(ai_toolset::AsyncToolCollection::new()),
            (),
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(pool.clone()),
            ),
        ),
        (*entity_access_service).clone(),
    );

    let tool_service_context = ai_tools::ToolServiceContext {
        search_service_client: search_service_client.clone(),
        email_service_client: email_service_client_external.clone(),
        soup_service: soup_service.clone(),
        email_service: email_service_for_tools.clone(),
        document_tool_context: document_tool_context.clone(),
        properties_tool_context: properties_tool_context.clone(),
        email_tool_context: email_tool_context.clone(),
        call_tool_context: call_tool_context.clone(),
        notification_tool_context: notification_tool_context.clone(),
        chat_tool_context,
        channel_tool_context: ai_tools::build_channel_tool_context(pool.clone()),
        team_tool_context: ai_tools::build_team_tool_context(pool.clone()),
        schedule_tool_context: ai_tools::no_op_schedule_context(),
    };
    let all_tools = ai_tools::all_tools();
    let all_tools_toolset = all_tools.toolset.clone();
    let all_tools_prompt = all_tools.prompt;

    let memory_repo = memory::outbound::pg_memory_repo::PgMemoryRepo::new(pool.clone());
    let memory_service = Arc::new(memory::domain::service::MemoryServiceImpl::new(
        pool.clone(),
        memory_repo,
        tool_service_context.clone(),
        all_tools,
    ));

    let api_context = ApiContext {
        db: pool.clone(),
        sqs_client: Arc::new(sqs_client),
        document_storage_client,
        comms_service_client,
        search_service_client,
        email_service_client_external,
        jwt_args: JwtValidationArgs::new_testing(),
        config: Arc::new(Config::new_empty_for_test()),
        internal_auth_key: LocalOrRemoteSecret::Local(InternalApiSecretKey::Comptime("testing")),
        notification_ingress_service,
        connection_repo: MockConnectionRepo::new(),
        soup_service,
        email_service: email_service_for_tools.clone(),
        stream_repo: MockStreamRepo::new(),
        document_tool_context: document_tool_context.clone(),
        memory_service,
        properties_tool_context,
        email_tool_context,
        call_tool_context,
        tool_service_context,
        all_tools: all_tools_toolset,
        all_tools_prompt,
        entity_access_service: entity_access_service.clone(),
        message_service: Arc::new(chat::domain::service::MessageServiceImpl::new(
            chat::outbound::postgres::PgChatRepo::new(pool.clone()),
            attachment::provider::AttachmentProvider {
                document: documents::inbound::attachment::DocumentAttachmentService::new(
                    document_tool_context.service.clone(),
                    document_tool_context.entity_access_service.clone(),
                    document_tool_context.lexical_client.clone(),
                ),
                email_thread: email::inbound::attachment::EmailAttachmentService::new(
                    email_service_for_tools.clone(),
                    entity_access_service.clone(),
                ),
                chat: chat::inbound::attachment::ChatAttachmentService::new(
                    Arc::new(chat::outbound::postgres::PgChatRepo::new(pool.clone())),
                    entity_access_service.clone(),
                ),
                channel: comms::inbound::attachment::CommsAttachmentService::new(
                    Arc::new(PgCommsRepo::new(readonly_pool::ReadOnlyPool(pool.clone()))),
                    entity_access_service.clone(),
                ),
                static_file: static_file::inbound::attachment::StaticFileAttachmentService::new(
                    Arc::new(static_file::outbound::CdnStaticFileRepo::new(
                        "http://localhost".into(),
                    )),
                ),
            },
        )),
        ai_stream_registry: crate::service::ai_stream_registry::AiStreamRegistry::new(Arc::new(
            redis::Client::open("redis://127.0.0.1:6379/").expect("valid redis url"),
        )),
        mcp_state: {
            let redis_client =
                Arc::new(redis::Client::open("redis://127.0.0.1:6379/").expect("valid redis url"));
            let mcp_key = mcp_client::domain::models::AesKey::try_from(vec![0u8; 32])
                .expect("valid test key");
            let mcp_repo =
                mcp_client::outbound::pg_server_repo::PgServerRepo::new(pool.clone(), mcp_key);
            let mcp_state_store =
                mcp_client::outbound::redis_state_store::RedisOAuthStateStore::new(redis_client);
            let mcp_oauth = mcp_client::domain::service::OAuthService::new(
                mcp_repo.clone(),
                mcp_state_store,
                "http://localhost/mcp/servers/auth/callback".to_string(),
                mcp_client::domain::provider_registry::PreRegisteredProviders::from_env(),
            );
            mcp_client::inbound::McpRouterState::new(mcp_repo, mcp_oauth)
        },
    };
    Arc::new(api_context)
}
