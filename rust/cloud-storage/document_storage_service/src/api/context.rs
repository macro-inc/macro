use contacts::domain::service::SqsContactsIngress;
use contacts::outbound::ingress::SqsContactsQueue;

use crate::{config::Config, service::s3::S3};
use axum::extract::FromRef;
use cal::{
    domain::service::CalWebhookServiceImpl, inbound::cal_webhook_router::CalWebhookRouterState,
    outbound::analytics_client::AnalyticsClientSink,
};
use call::{
    domain::service::CallServiceImpl,
    inbound::axum_router::{CallRouterState, InternalCallRouterState, WebhookRouterState},
    outbound::{livekit_rtc_client::LivekitRtcClient, pg_call_repo::PgCallRepo},
};
use channels::{
    domain::service::ChannelMessagesServiceImpl, inbound::axum_router::ChannelsRouterState,
    outbound::pg_channels_repo::PgChannelMessagesRepo,
};
use comms::{
    domain::service::ChannelServiceImpl,
    inbound::router::CommsRouterState,
    outbound::postgres::{comms_repo::PgCommsRepo, user_repo::PgUserRepo},
};
use comms_service::CommsHandlerState;
use connection::{
    domain::service::ConnectionServiceImpl,
    outbound::connection_gateway_client::ConnectionGatewayImpl,
};
use connection_gateway_client::client::ConnectionGatewayClient;
use documents_hex::domain::ports::TaskPropertiesPort;
use documents_hex::domain::service::DocumentServiceImpl;
use documents_hex::inbound::axum_router::DocumentRouterState;
use documents_hex::outbound::pg_document_repo::PgDocumentRepo;
use documents_hex::outbound::s3_upload_url::S3UploadUrlAdapter;
use dynamodb_client::DynamodbClient;
use email::{
    domain::{ports::ReadonlyEmailPreviewAdapter, service::EmailServiceImpl},
    outbound::EmailPgRepo,
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use github::domain::service::GithubSyncServiceImpl;
use github::outbound::github_sync_client::GithubSyncClientImpl;
use github::outbound::pg_github_sync_repo::PgGithubSyncRepo;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env_var::env_var;
use macro_sha_count_client::Redis;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use opensearch_client::OpensearchClient;
use properties::{
    NotificationServiceImpl, PermissionServiceImpl, PropertiesPgRepo, PropertiesServiceImpl,
};
use properties_service::PropertiesHandlerState;
use readonly_pool::ReadOnlyPool;
use search_service::SearchHandlerState;
use secretsmanager_client::LocalOrRemoteSecret;
use soup::{
    domain::service::SoupImpl, inbound::axum_router::SoupRouterState,
    outbound::pg_soup_repo::PgSoupRepo,
};
use sqlx::PgPool;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;
use system_properties::{
    PgSystemPropertiesRepository, StatusOption, SystemPropertiesService as _,
    SystemPropertiesServiceImpl,
};

#[derive(Debug, Clone)]
pub struct InternalFlag {
    pub internal: bool,
}

type DssEmailService = EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    email::domain::ports::NoOpEnqueuer,
>;

type DssSoupState = SoupRouterState<
    SoupImpl<
        PgSoupRepo,
        FrecencyQueryServiceImpl<FrecencyPgStorage>,
        ReadonlyEmailPreviewAdapter<DssEmailService>,
        ChannelServiceImpl<PgCommsRepo, PgUserRepo, FrecencyPgStorage>,
        call::domain::service::CallRecordQueryServiceImpl<call::outbound::pg_call_repo::PgCallRepo>,
    >,
    DssEmailService,
>;

type SystemPropertiesService = SystemPropertiesServiceImpl<PgSystemPropertiesRepository>;
pub(crate) type NotificationIngressType = SqsNotificationIngress<SqsQueue>;
pub(crate) type PropertiesService = PropertiesServiceImpl<
    PropertiesPgRepo,
    PermissionServiceImpl<EntityAccessService>,
    NotificationServiceImpl<NotificationIngressType>,
>;

/// Type alias for the entity access service.
pub(crate) type EntityAccessService = EntityAccessServiceImpl<PgAccessRepository>;

/// Adapter implementing [`TaskPropertiesPort`] for the system properties service.
pub(crate) struct TaskPropertiesAdapter {
    pub system_properties: Arc<SystemPropertiesService>,
    pub properties: Arc<PropertiesService>,
}

impl TaskPropertiesPort for TaskPropertiesAdapter {
    async fn attach_task_properties(&self, entity_ids: Vec<String>) -> anyhow::Result<()> {
        self.system_properties
            .attach_task_properties(entity_ids)
            .await
            .map_err(Into::into)
    }

    async fn update_task_status(&self, task_id: &str, status: &str) -> anyhow::Result<()> {
        let status_option = StatusOption::try_from(status).map_err(|e| anyhow::anyhow!(e))?;

        self.system_properties
            .update_task_status(task_id, status_option)
            .await?;

        Ok(())
    }

    async fn set_entity_property(
        &self,
        user_id: &str,
        entity_id: &str,
        property_definition_id: uuid::Uuid,
        value: Option<models_properties::api::requests::SetPropertyValue>,
    ) -> anyhow::Result<()> {
        use properties::PropertiesService as _;

        self.properties
            .set_entity_property(
                user_id,
                entity_id,
                models_properties::EntityType::Task,
                property_definition_id,
                value,
            )
            .await
            .map_err(Into::into)
    }

    async fn copy_task_properties(
        &self,
        from_task_id: &str,
        to_task_id: &str,
    ) -> anyhow::Result<()> {
        use system_properties::SystemPropertiesService as _;

        self.system_properties
            .copy_task_properties(from_task_id, to_task_id)
            .await
            .map_err(Into::into)
    }
}

pub(crate) type EntityAccessManagementService =
    entity_access_management::domain::service::EntityAccessManagementServiceImpl<
        entity_access_management::outbound::PgRepository,
    >;

pub(crate) type DocumentService = DocumentServiceImpl<
    PgDocumentRepo,
    S3UploadUrlAdapter,
    TaskPropertiesAdapter,
    ConnectionServiceImpl<EntityAccessService, ConnectionGatewayImpl>,
    EntityAccessManagementService,
>;

/// Type alias for the documents router state.
pub(crate) type DocumentsState = DocumentRouterState<DocumentService, EntityAccessService>;

/// Type alias for the ChannelServiceImpl used by comms
pub(crate) type CommsChannelService =
    ChannelServiceImpl<PgCommsRepo, PgUserRepo, FrecencyPgStorage>;

/// Type alias for the CommsRouterState
pub(crate) type CommsState = CommsRouterState<CommsChannelService>;

/// Type alias for the channels router state.
pub(crate) type DssChannelsState =
    ChannelsRouterState<ChannelMessagesServiceImpl<PgChannelMessagesRepo>, EntityAccessService>;

/// Type alias for the call connection service.
pub(crate) type CallConnectionService =
    ConnectionServiceImpl<EntityAccessService, ConnectionGatewayImpl>;

/// Type alias for the VoIP push sender (optional at runtime via `Option`).
pub(crate) type DssVoipPushSender = Option<
    notification::domain::service::VoipPushServiceImpl<
        notification::outbound::repository::DbNotificationRepository<sqlx::PgPool>,
        aws_sdk_sns::Client,
    >,
>;

/// Type alias for the call service.
pub(crate) type DssCallService = CallServiceImpl<
    PgCallRepo,
    LivekitRtcClient,
    CallConnectionService,
    EntityAccessService,
    NotificationIngressType,
    Option<call::outbound::s3_recording_storage::S3RecordingStorage>,
    call::outbound::ai_call_summarizer::AiCallSummarizer,
    crate::service::call_search_indexer::SqsCallSearchIndexer,
    DssVoipPushSender,
    call::outbound::pg_voice_repo::PgVoiceRepo,
>;

/// Type alias for the call router state.
pub(crate) type DssCallState = CallRouterState<DssCallService, EntityAccessService>;

/// Type alias for the call webhook router state.
pub(crate) type DssCallWebhookState = WebhookRouterState<DssCallService>;

/// Type alias for the internal call router state.
pub(crate) type DssCallInternalState = InternalCallRouterState<DssCallService>;

/// Type alias for the github sync service.
pub(crate) type GithubSyncServiceType =
    GithubSyncServiceImpl<DocumentService, PgGithubSyncRepo, GithubSyncClientImpl>;

/// Type alias for the cal.com webhook service.
pub(crate) type CalWebhookServiceType = CalWebhookServiceImpl<AnalyticsClientSink>;

/// Type alias for the cal.com webhook router state.
pub(crate) type DssCalWebhookState = CalWebhookRouterState<CalWebhookServiceType>;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: PgPool,
    pub readonly_db: ReadOnlyPool,
    pub redis_client: Arc<Redis>,
    pub s3_client: Arc<S3>,
    pub github_sync_service: Arc<GithubSyncServiceType>,
    pub dynamodb_client: Arc<DynamodbClient>,
    pub dynamo_db: aws_sdk_dynamodb::Client,
    pub soup_router_state: DssSoupState,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub contacts_ingress: Arc<SqsContactsIngress<SqsContactsQueue>>,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub conn_gateway_client: Arc<ConnectionGatewayClient>,
    pub sync_service_client: Arc<SyncServiceClient>,
    pub system_properties_service: Arc<SystemPropertiesService>,
    pub properties_service: Arc<PropertiesService>,
    pub opensearch_client: Arc<OpensearchClient>,
    pub jwt_validation_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub dss_auth_key: DocumentStorageServiceAuthKey,
    // Comms service fields
    pub frecency_storage: FrecencyPgStorage,
    pub comms_state: CommsState,
    pub permissions_token_secret:
        LocalOrRemoteSecret<comms_service::DocumentPermissionJwtSecretKey>,
    pub entity_access_service: Arc<EntityAccessService>,
    pub documents_state: DocumentsState,
    pub channels_state: DssChannelsState,
    pub call_state: DssCallState,
    pub call_webhook_state: DssCallWebhookState,
    pub call_internal_state: DssCallInternalState,
    pub cal_webhook_state: DssCalWebhookState,
    pub entity_access_management_service: EntityAccessManagementService,
}

env_var! {
    #[derive(Clone)]
    pub struct DocumentStorageServiceAuthKey;
}

impl From<&ApiContext> for PropertiesHandlerState {
    fn from(ctx: &ApiContext) -> Self {
        PropertiesHandlerState {
            db: ctx.db.clone(),
            properties_service: ctx.properties_service.clone(),
            entity_access_service: ctx.entity_access_service.clone(),
        }
    }
}

impl FromRef<ApiContext> for PropertiesHandlerState {
    fn from_ref(ctx: &ApiContext) -> Self {
        PropertiesHandlerState::from(ctx)
    }
}

impl From<&ApiContext> for SearchHandlerState {
    fn from(ctx: &ApiContext) -> Self {
        SearchHandlerState {
            db: ctx.readonly_db.clone(),
            opensearch_client: ctx.opensearch_client.clone(),
        }
    }
}

impl FromRef<ApiContext> for SearchHandlerState {
    fn from_ref(ctx: &ApiContext) -> Self {
        SearchHandlerState::from(ctx)
    }
}

impl From<&ApiContext> for CommsHandlerState {
    fn from(ctx: &ApiContext) -> Self {
        CommsHandlerState {
            jwt_validation_args: ctx.jwt_validation_args.clone(),
            db: ctx.db.clone(),
            connection_gateway_client: ctx.conn_gateway_client.clone(),
            notification_ingress_service: ctx.notification_ingress_service.clone(),
            sqs_client: ctx.sqs_client.clone(),
            contacts_ingress: ctx.contacts_ingress.clone(),
            permissions_token_secret: ctx.permissions_token_secret.clone(),
            frecency_storage: ctx.frecency_storage.clone(),
            comms_state: ctx.comms_state.clone(),
            entity_access_service: ctx.entity_access_service.clone(),
        }
    }
}

impl FromRef<ApiContext> for CommsHandlerState {
    fn from_ref(ctx: &ApiContext) -> Self {
        CommsHandlerState::from(ctx)
    }
}
