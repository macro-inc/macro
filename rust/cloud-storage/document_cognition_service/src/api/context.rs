use crate::config::Config;
use ai_tools::ToolSoupService;
use axum::extract::FromRef;
use connection_gateway_client::service::connection::ConnectionRepo;
use document_storage_service_client::DocumentStorageServiceClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use notification::domain::models::email_notification_digest::StateMachineDriverA;
use notification::domain::service::NotificationIngressService;
use notification::outbound::{
    digest_batcher::RedisDigestBatcher, last_online_checker::LastOnlineCheckerImpl,
    push_notification_checker::PushNotificationCheckerImpl, queue::SqsNotificationQueue,
    repository::DbNotificationRepository, user_existence_checker::DbUserExistenceChecker,
};
use scribe::{
    ScribeClient, channel::ChannelClient, dcs::DcsClient, document::DocumentClient,
    email::EmailClient, static_file::StaticFileClient,
};
use search_service_client::SearchServiceClient;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::{Arc, OnceLock};
use stream::domain::StreamRepo;

pub type DcsScribe =
    ScribeClient<DocumentClient, ChannelClient, DcsClient, EmailClient, StaticFileClient>;

type StateMachine = StateMachineDriverA<
    DbUserExistenceChecker,
    PushNotificationCheckerImpl<DbNotificationRepository<PgPool>>,
    LastOnlineCheckerImpl<
        last_online_tracker::outbound::time::DefaultTime,
        last_online_tracker::outbound::redis::RedisLastOnlineRepo,
    >,
    RedisDigestBatcher,
>;
pub(crate) type NotificationIngressType = NotificationIngressService<
    DbNotificationRepository<PgPool>,
    SqsNotificationQueue,
    StateMachine,
>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub db: PgPool,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub document_storage_client: Arc<DocumentStorageServiceClient>,
    pub comms_service_client: Arc<comms_service_client::CommsServiceClient>,
    pub search_service_client: Arc<SearchServiceClient>,
    pub scribe: Arc<DcsScribe>,
    pub email_service_client_external: Arc<email_service_client::EmailServiceClientExternal>,
    pub jwt_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub connection_repo: Arc<dyn ConnectionRepo>,
    pub soup_service: Arc<ToolSoupService>,
    pub stream_repo: Arc<dyn StreamRepo>,
}

pub static GLOBAL_CONTEXT: OnceLock<ApiContext> = OnceLock::new();

#[cfg(test)]
mod mock_connection_repo {
    use connection_gateway_client::model::connection::StoredConnectionEntity;
    use connection_gateway_client::model::tracking::{EntityConnection, UserEntityConnection};
    use connection_gateway_client::service::connection::ConnectionRepo;
    use std::sync::Arc;

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
        async fn get_connection(
            &self,
            _connection_id: &str,
        ) -> anyhow::Result<StoredConnectionEntity> {
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
}

#[cfg(test)]
mod mock_stream {
    use std::sync::Arc;
    use stream::domain::{ItemId, ItemStream, Result, StreamEvent, StreamId, StreamRepo};
    use tokio::sync::broadcast::{self, Receiver};

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
        async fn append(&self, _id: &StreamId, _payload: serde_json::Value) -> Result<ItemId> {
            Ok("mock-item-id".to_string())
        }

        async fn stream_from_beginning(&self, _id: &StreamId) -> Result<ItemStream> {
            Ok(Box::pin(futures::stream::empty()))
        }

        async fn close(&self, _id: &StreamId) -> Result<()> {
            Ok(())
        }

        async fn active_streams(&self, _entity_id: &str) -> Result<Vec<StreamId>> {
            Ok(vec![])
        }

        async fn notify(&self) -> Receiver<StreamEvent> {
            self.tx.subscribe()
        }
    }
}

#[cfg(test)]
pub async fn test_api_context(pool: sqlx::Pool<sqlx::Postgres>) -> std::sync::Arc<ApiContext> {
    use aws_sdk_sqs;
    use comms::domain::service::ChannelServiceImpl;
    use comms::outbound::http::user_repo::UserRepoImpl;
    use comms::outbound::postgres::comms_repo::PgCommsRepo;
    use comms_service_client::CommsServiceClient;
    use document_cognition_service_client::DocumentCognitionServiceClient;
    use document_storage_service_client::DocumentStorageServiceClient;
    use email::domain::service::EmailServiceImpl;
    use email::outbound::EmailPgRepo;
    use email_service_client::{EmailServiceClient, EmailServiceClientExternal};
    use frecency::domain::services::FrecencyQueryServiceImpl;
    use frecency::outbound::postgres::FrecencyPgStorage;
    use lexical_client::LexicalClient;
    use notification::domain::models::email_notification_digest::{
        EmailBlockList, ExplicitInviteAllowList, NotificationSetBuilder, StateMachineDriverA,
    };
    use notification::domain::service::NotificationIngressService;
    use notification::outbound::{
        digest_batcher::RedisDigestBatcher, last_online_checker::LastOnlineCheckerImpl,
        push_notification_checker::PushNotificationCheckerImpl, queue::SqsNotificationQueue,
        repository::DbNotificationRepository, user_existence_checker::DbUserExistenceChecker,
    };
    use scribe::ScribeClient;
    use search_service_client::SearchServiceClient;
    use soup::domain::service::SoupImpl;
    use soup::outbound::pg_soup_repo::PgSoupRepo;
    use sqs_client::SQS;
    use static_file_service_client::StaticFileServiceClient;
    use std::sync::Arc;
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
                .with_sync_service_client(sync_service_client)
                .with_macro_db(pool.clone())
                .build(),
        )
        .with_channel_client_and_db(comms_service_client.clone(), pool.clone())
        .with_dcs_client(document_cognition_service_client)
        .with_email_client(email_service_client)
        .with_static_file_client(static_file_service_client.clone());

    // Build soup service dependencies
    let frecency_storage = FrecencyPgStorage::new(pool.clone());
    let frecency_service = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email_service =
        EmailServiceImpl::new(EmailPgRepo::new(pool.clone()), frecency_service.clone());
    let user_repo = UserRepoImpl::new("dummy_auth_key".into(), "http://localhost".parse().unwrap());
    let channels_service = ChannelServiceImpl::new(
        PgCommsRepo { pool: pool.clone() },
        user_repo,
        frecency_storage,
    );
    let soup_service = Arc::new(SoupImpl::new(
        PgSoupRepo::new(pool.clone()),
        frecency_service,
        email_service,
        channels_service,
    ));

    let redis_client = redis::Client::open("redis://localhost:6379").unwrap();
    let redis_multiplexed_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .unwrap();

    let notification_ingress_service = Arc::new({
        let notification_repository = DbNotificationRepository::new(pool.clone());
        let notification_queue = SqsNotificationQueue::new(
            aws_sdk_sqs::Client::from_conf(sqs_config),
            "test-notification-queue".to_string(),
        );
        let state_machine = StateMachineDriverA {
            user_checker: DbUserExistenceChecker::new(pool.clone()),
            notification_checker: PushNotificationCheckerImpl::new(DbNotificationRepository::new(
                pool.clone(),
            )),
            online_checker: LastOnlineCheckerImpl::new(
                last_online_tracker::domain::services::LastOnlineService::new(
                    last_online_tracker::outbound::time::DefaultTime,
                    last_online_tracker::outbound::redis::RedisLastOnlineRepo::new(
                        redis_multiplexed_conn.clone(),
                    ),
                ),
            ),
            digest_batcher: RedisDigestBatcher::new(redis_multiplexed_conn),
            block_list: EmailBlockList::new::<model_notifications::NewEmailMetadata>(),
            invite_list: ExplicitInviteAllowList::new::<model_notifications::InviteToTeamMetadata>(
            )
            .append::<model_notifications::ChannelInviteMetadata>(),
            digest_window: std::time::Duration::from_secs(30 * 60),
            online_duration_threshold: std::time::Duration::from_secs(60 * 60),
        };
        NotificationIngressService::new(notification_repository, notification_queue, state_machine)
    });

    let api_context = ApiContext {
        db: pool.clone(),
        sqs_client: Arc::new(sqs_client),
        document_storage_client,
        comms_service_client,
        search_service_client: Arc::new(search_service_client),
        scribe: Arc::new(content_client),
        email_service_client_external,
        jwt_args: JwtValidationArgs::new_testing(),
        config: Arc::new(Config::new_empty_for_test()),
        internal_auth_key: LocalOrRemoteSecret::Local(InternalApiSecretKey::Comptime("testing")),
        notification_ingress_service,
        connection_repo: mock_connection_repo::MockConnectionRepo::new(),
        soup_service,
        stream_repo: mock_stream::MockStreamRepo::new(),
    };
    Arc::new(api_context)
}
