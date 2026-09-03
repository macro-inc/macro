use contacts::domain::service::SqsContactsIngress;
use contacts::outbound::ingress::SqsContactsQueue;

use crate::{config::Config, service::s3::S3};
use axum::extract::FromRef;
use bots::{
    domain::service::BotServiceImpl,
    inbound::{axum_router::BotsRouterState, channel_webhook_router::ChannelBotWebhookRouterState},
    outbound::pg_bots_repo::PgBotsRepo,
};
use cal::{
    domain::service::CalWebhookServiceImpl, inbound::cal_webhook_router::CalWebhookRouterState,
    outbound::analytics_client::AnalyticsClientSink,
};
use calendar_events::{
    domain::service::CalendarService, inbound::axum_router::CalendarRouterState,
    outbound::pg::PgCalendarRepository,
};
use call::{
    domain::service::CallServiceImpl,
    inbound::axum_router::{CallRouterState, InternalCallRouterState, WebhookRouterState},
    outbound::{livekit_rtc_client::LivekitRtcClient, pg_call_repo::PgCallRepo},
};
use channels::{
    domain::{
        list_service::ChannelListServiceImpl,
        service::ChannelServiceImpl,
        side_effects::{ChannelSideEffectService, SpawnedChannelEventDispatcher},
    },
    inbound::{axum_router::ChannelsRouterState, list_router::ChannelListRouterState},
    outbound::{
        connection_gateway_realtime::ConnectionGatewayChannelRealtimePublisher,
        contacts_dispatcher::ContactsChannelDispatcher,
        notification_sender::NotificationChannelSender,
        pg_channel_reference_share_permissions::PgChannelReferenceSharePermissions,
        pg_channels_repo::PgChannelsRepo, pg_side_effect_context::PgChannelSideEffectContext,
    },
};
use connection::{
    domain::service::ConnectionServiceImpl,
    outbound::connection_gateway_client::ConnectionGatewayImpl,
};
use connection_gateway_client::client::ConnectionGatewayClient;
use documents_hex::domain::ports::{TaskPropertiesPort, task_property_edit_receipt};
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
use favorites::{
    domain::service::FavoritesServiceImpl, inbound::axum_router::FavoritesRouterState,
    outbound::pg_favorites_repo::PgFavoritesRepo,
};
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use user_api_key::{
    domain::service::UserApiKeyServiceImpl, inbound::axum_router::UserApiKeyRouterState,
    outbound::pg_user_api_keys_repo::PgUserApiKeysRepo,
};

use collab_surface::{
    domain::service::CollabSurfaceServiceImpl, inbound::axum_router::CollabSurfaceRouterState,
    outbound::pg_collab_surface_repo::PgCollabSurfaceRepo,
    outbound::surface_init::LexicalSyncSurfaceInitializer,
};
use foreign_entity::{
    domain::service::ForeignEntityServiceImpl, inbound::axum_router::ForeignEntityRouterState,
    outbound::pg_foreign_entity_repo::PgForeignEntityRepo,
};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use github::domain::service::GithubSyncServiceImpl;
use github::outbound::github_sync_client::GithubSyncClientImpl;
use github::outbound::pg_github_sync_repo::PgGithubSyncRepo;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use macro_env_var::env_var;
use macro_sha_count_client::Redis;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use opensearch_client::OpensearchClient;
use projects_hex::{
    domain::service::ProjectServiceImpl,
    inbound::axum_router::ProjectRouterState,
    outbound::{
        DynamoBulkUploadAdapter, PgProjectRepo, S3ProjectUploadAdapter, ShaCountAdapter,
        SqsProjectSearchIndexer,
    },
};
use properties::{
    NotificationServiceImpl, PermissionServiceImpl, PropertiesPgRepo, PropertiesServiceImpl,
    inbound::axum_router::PropertiesRouterState,
};
use readonly_pool::ReadOnlyPool;
use reminders::{
    domain::service::RemindersServiceImpl, inbound::axum_router::RemindersRouterState,
    outbound::pg_reminders_repo::PgRemindersRepo,
};
use search_service::SearchHandlerState;
use soup::{
    domain::service::SoupImpl, inbound::axum_router::SoupRouterState,
    outbound::pg_soup_repo::PgSoupRepo,
};
use soup_realtime::{
    domain::service::SoupRealtimeConsumerService, outbound::soup_consumer::SoupTopicConsumer,
};
use sqlx::PgPool;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;
use system_properties::{
    PgSystemPropertiesRepository, StatusOption, SystemPropertiesService as _,
    SystemPropertiesServiceImpl,
};
use tokio_util::task::TaskTracker;
use webhook::{
    domain::service::WebhookServiceImpl,
    domain::stream::WebhookEventStreamServiceImpl,
    inbound::axum_router::WebhookRouterState as MacroWebhookRouterState,
    inbound::stream_router::WebhookStreamRouterState,
    outbound::{
        http_validator::ReqwestWebhookValidationClient,
        pg_repository::PgRepository as PgWebhookRepo,
    },
};

/// Event broker shared by DSS services.
pub(crate) type DssEventBroker = MacroEventBrokerService<KafkaEventPublisher, TaskTracker>;

/// CRM service for DSS — no-op resolver since DSS doesn't populate.
pub(crate) type DssCrmService = crm::domain::service::CrmServiceImpl<
    crm::outbound::companies_repo::CompaniesRepositoryImpl,
    crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
>;

pub(crate) type DssEmailService = EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    sqs_client::SQS,
    DssCrmService,
    EntityAccessManagementService,
    DssEventBroker,
>;

/// CRM router state.
pub(crate) type DssCrmState = crm::inbound::axum_router::CrmRouterState<
    DssCrmService,
    EntityAccessService,
    AuthorizationService,
>;

pub(crate) type DssSoupService = SoupImpl<
    PgSoupRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    ReadonlyEmailPreviewAdapter<DssEmailService>,
    ChannelListServiceImpl<PgChannelsRepo, PgChannelsRepo, FrecencyPgStorage>,
    call::domain::service::CallRecordQueryServiceImpl<call::outbound::pg_call_repo::PgCallRepo>,
    DssCrmService,
    ForeignEntityServiceType,
    RemindersServiceType,
>;

type DssSoupState =
    SoupRouterState<DssSoupService, DssEmailService, EntityAccessService, AuthorizationService>;

/// Realtime Soup consumer service used by GraphQL subscriptions.
pub(crate) type DssSoupRealtimeService = SoupRealtimeConsumerService<SoupTopicConsumer>;

/// Realtime notification consumer service used by GraphQL subscriptions.
pub(crate) type DssNotificationRealtimeService =
    notification::domain::service::WebSocketNotificationConsumerService<
        notification::outbound::notification_consumer::NotificationTopicConsumer<
            model_notifications::NotifEvent,
        >,
        model_notifications::NotifEvent,
    >;

/// GraphQL Soup schema wired to the DSS services; the `ApiContext` state
/// parameter lets GraphQL resolvers run the same axum extractors as the REST
/// routes, lazily, against the stored request parts.
pub(crate) type DssGraphqlSoupSchema = complete_graph::SharedSoupSchema<
    DssSoupService,
    DssSoupRealtimeService,
    DssNotificationRealtimeService,
    DssEmailService,
    EntityAccessService,
    AuthorizationService,
    ApiContext,
    complete_graph::PropertiesEntityPropertyWriter<PropertiesService, EntityAccessService>,
    DssEntityMutationService,
    DssChannelService,
    ai_tools::ToolNotificationService,
    Arc<ai_tools::ToolNotificationService>,
    complete_graph::PropertiesEntityPropertyReader<PropertiesService, EntityAccessService>,
    complete_graph::EmailServiceEmailContentReader<DssEmailService, EntityAccessService>,
    Arc<FavoritesServiceType>,
    Arc<EntityAccessService>,
    DssActivityReader,
>;

/// GraphQL activity reader over the Postgres activity log (readonly pool).
pub(crate) type DssActivityReader =
    complete_graph::ActivityPortReader<activity::outbound::pg_activity_repo::PgActivityRepo>;

type SystemPropertiesService = SystemPropertiesServiceImpl<PgSystemPropertiesRepository>;
pub(crate) type NotificationIngressType = SqsNotificationIngress<SqsQueue>;
pub(crate) type PropertiesService = PropertiesServiceImpl<
    PropertiesPgRepo,
    PermissionServiceImpl<EntityAccessService>,
    NotificationServiceImpl<NotificationIngressType>,
    DssEventBroker,
>;

/// Concrete properties router state wired into DSS.
pub(crate) type PropertiesHandlerState =
    PropertiesRouterState<PropertiesService, EntityAccessService, AuthorizationService>;

/// Type alias for the entity access service.
pub(crate) type EntityAccessService = EntityAccessServiceImpl<PgAccessRepository>;

/// Calendar occurrence query service.
pub(crate) type DssCalendarService = CalendarService<PgCalendarRepository>;

/// Calendar occurrence router state.
pub(crate) type DssCalendarState = CalendarRouterState<DssCalendarService, AuthorizationService>;

/// Adapter implementing [`TaskPropertiesPort`] for the system properties service.
pub(crate) struct TaskPropertiesAdapter {
    pub system_properties: Arc<SystemPropertiesService>,
    pub properties: Arc<PropertiesService>,
    pub entity_access_service: Arc<EntityAccessService>,
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
        attribution: &activity::Attribution,
    ) -> anyhow::Result<()> {
        use properties::PropertiesService as _;

        let user_id = macro_user_id::user_id::MacroUserIdStr::parse_from_str(user_id)?;
        let entity_access_receipt = task_property_edit_receipt(
            self.entity_access_service.as_ref(),
            &user_id,
            attribution,
            entity_id,
        )
        .await?;
        self.properties
            .set_entity_property(&entity_access_receipt, property_definition_id, value)
            .await
            .map(|_| ())
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
    ForeignEntityServiceImpl<PgForeignEntityRepo>,
    DssEventBroker,
>;

/// Type alias for the authorization service.
pub(crate) type AuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

/// Type alias for the documents router state.
pub(crate) type DocumentsState =
    DocumentRouterState<DocumentService, EntityAccessService, AuthorizationService>;

/// Concrete project service wired into DSS.
pub(crate) type ProjectService = ProjectServiceImpl<
    PgProjectRepo,
    S3ProjectUploadAdapter,
    DynamoBulkUploadAdapter,
    ShaCountAdapter,
    EntityAccessManagementService,
    SqsProjectSearchIndexer<DssEventBroker>,
    DssEventBroker,
>;

/// Type alias for the projects router state.
pub(crate) type ProjectsState =
    ProjectRouterState<ProjectService, EntityAccessService, AuthorizationService>;

/// Type alias for the legacy channel list service.
pub(crate) type DssChannelListService =
    ChannelListServiceImpl<PgChannelsRepo, PgChannelsRepo, FrecencyPgStorage>;

/// Type alias for the legacy channel list router state.
pub(crate) type DssChannelListState =
    ChannelListRouterState<DssChannelListService, AuthorizationService>;

/// Type alias for the channels service wired into DSS.
pub(crate) type DssChannelService = ChannelServiceImpl<
    PgChannelsRepo,
    SpawnedChannelEventDispatcher<
        ChannelSideEffectService<
            PgChannelSideEffectContext,
            ConnectionGatewayChannelRealtimePublisher,
            NotificationChannelSender<NotificationIngressType>,
            ContactsChannelDispatcher<SqsContactsIngress<SqsContactsQueue>>,
            DssEventBroker,
        >,
    >,
    PgChannelReferenceSharePermissions<EntityAccessService>,
    lexical_mention_extractor::LexicalMentionExtractor,
>;

/// Type alias for the channels router state.
pub(crate) type DssChannelsState =
    ChannelsRouterState<DssChannelService, EntityAccessService, AuthorizationService>;

/// Type alias for the bots service wired into DSS.
pub(crate) type DssBotService = BotServiceImpl<PgBotsRepo, DssEventBroker>;

/// Type alias for the bots router state.
pub(crate) type DssBotsState =
    BotsRouterState<DssBotService, EntityAccessService, AuthorizationService>;

/// Type alias for the harnesses service wired into DSS.
pub(crate) type DssHarnessService = harnesses::domain::service::HarnessServiceImpl<
    harnesses::outbound::pg_harness_repo::PgHarnessRepo,
>;

/// Type alias for the harnesses router state.
pub(crate) type DssHarnessesState =
    harnesses::inbound::axum_router::HarnessesRouterState<DssHarnessService, AuthorizationService>;

/// Type alias for the channel bot webhook router state.
pub(crate) type DssChannelBotWebhookState = ChannelBotWebhookRouterState<
    DssBotService,
    Arc<DssChannelService>,
    EntityAccessService,
    AuthorizationService,
>;

/// Type alias for the call connection service.
pub(crate) type CallConnectionService =
    ConnectionServiceImpl<EntityAccessService, ConnectionGatewayImpl>;

/// Type alias for the VoIP push sender (optional at runtime via `Option`).
pub(crate) type DssVoipPushSender = Option<
    notification::domain::service::VoipPushServiceImpl<
        notification::outbound::repository::DbNotificationRepository<sqlx::PgPool>,
        notification::outbound::mobile::MobilePushAdapter<aws_sdk_sns::Client>,
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
    DssVoipPushSender,
    call::outbound::pg_voice_repo::PgVoiceRepo,
    DssEventBroker,
>;

/// Type alias for the call router state.
pub(crate) type DssCallState =
    CallRouterState<DssCallService, EntityAccessService, AuthorizationService>;

/// Type alias for the call webhook router state.
pub(crate) type DssCallWebhookState = WebhookRouterState<DssCallService>;

/// Type alias for the internal call router state.
pub(crate) type DssCallInternalState = InternalCallRouterState<DssCallService>;

/// Chat service used by the unified entity mutation adapter.
pub(crate) type DssChatMutationService = chat::domain::service::ChatServiceImpl<
    chat::outbound::postgres::PgChatRepo,
    (),
    EntityAccessManagementService,
>;

/// Concrete unified entity mutation service wired into GraphQL.
pub(crate) type DssEntityMutationService =
    crate::service::entity_mutation::DssEntityMutationService<
        DocumentService,
        DssChatMutationService,
        DssChannelService,
        DssCallService,
        DssEmailService,
        ProjectService,
        EntityAccessService,
        FavoritesServiceType,
        crate::outbound::entity_mutation::DssEntityLifecycleAdapter<DssEventBroker>,
    >;

/// Type alias for the favorites service.
pub(crate) type FavoritesServiceType = FavoritesServiceImpl<PgFavoritesRepo>;

/// Type alias for the favorites router state.
pub(crate) type DssFavoritesState =
    FavoritesRouterState<FavoritesServiceType, EntityAccessService, AuthorizationService>;

/// Type alias for the user API key service.
pub(crate) type UserApiKeyServiceType = UserApiKeyServiceImpl<PgUserApiKeysRepo>;

/// Type alias for the user API key router state.
pub(crate) type DssUserApiKeyState =
    UserApiKeyRouterState<UserApiKeyServiceType, AuthorizationService>;

/// Type alias for the reminders service.
pub(crate) type RemindersServiceType = RemindersServiceImpl<PgRemindersRepo>;

/// Type alias for the reminders router state.
pub(crate) type DssRemindersState =
    RemindersRouterState<RemindersServiceType, EntityAccessService, AuthorizationService>;

/// Type alias for the collab-surface service.
pub(crate) type CollabSurfaceServiceType =
    CollabSurfaceServiceImpl<PgCollabSurfaceRepo, LexicalSyncSurfaceInitializer>;

/// Type alias for the collab-surface router state.
pub(crate) type DssCollabSurfaceState =
    CollabSurfaceRouterState<CollabSurfaceServiceType, EntityAccessService, AuthorizationService>;

/// Type alias for the foreign entity service.
pub(crate) type ForeignEntityServiceType = ForeignEntityServiceImpl<PgForeignEntityRepo>;

/// Type alias for the foreign entity router state.
pub(crate) type DssForeignEntityState =
    ForeignEntityRouterState<ForeignEntityServiceType, EntityAccessService, AuthorizationService>;

/// Type alias for the github sync service.
pub(crate) type GithubSyncServiceType = GithubSyncServiceImpl<
    DocumentService,
    PgGithubSyncRepo,
    GithubSyncClientImpl,
    ForeignEntityServiceType,
    NotificationIngressType,
>;

/// Type alias for the cal.com webhook service.
pub(crate) type CalWebhookServiceType = CalWebhookServiceImpl<AnalyticsClientSink>;

/// Type alias for the cal.com webhook router state.
pub(crate) type DssCalWebhookState = CalWebhookRouterState<CalWebhookServiceType>;

/// Type alias for the product webhook service.
pub(crate) type DssWebhookService =
    WebhookServiceImpl<PgWebhookRepo, ReqwestWebhookValidationClient, DssEventBroker>;

/// Type alias for the product webhook rate limiter.
pub(crate) type DssWebhookRateLimiter =
    rate_limit::RateLimitServiceImpl<rate_limit::RedisRateLimitAdapter<redis::Client>>;

/// Type alias for the product webhook router state.
pub(crate) type DssWebhookState =
    MacroWebhookRouterState<DssWebhookService, DssWebhookRateLimiter, AuthorizationService>;

/// Type alias for the service backing the webhook-event SSE endpoint.
pub(crate) type DssSseStreamService =
    WebhookEventStreamServiceImpl<EntityAccessService, PgWebhookRepo>;

/// Type alias for the webhook-event SSE router state.
pub(crate) type DssSseStreamState =
    WebhookStreamRouterState<DssSseStreamService, AuthorizationService>;

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
    pub graphql_soup_schema: DssGraphqlSoupSchema,
    pub graphql_notification_reader: Arc<ai_tools::ToolNotificationService>,
    pub activity_reader: DssActivityReader,
    pub graphql_entity_mutation_service: Arc<DssEntityMutationService>,
    pub favorites_state: DssFavoritesState,
    pub favorites_service: Arc<FavoritesServiceType>,
    pub user_api_key_state: DssUserApiKeyState,
    pub reminders_state: DssRemindersState,
    pub collab_surface_state: DssCollabSurfaceState,
    pub foreign_entity_state: DssForeignEntityState,
    pub macro_event_broker: DssEventBroker,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub contacts_ingress: Arc<SqsContactsIngress<SqsContactsQueue>>,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub conn_gateway_client: Arc<ConnectionGatewayClient>,
    pub sync_service_client: Arc<SyncServiceClient>,
    pub system_properties_service: Arc<SystemPropertiesService>,
    pub properties_service: Arc<PropertiesService>,
    pub opensearch_client: Arc<OpensearchClient>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub jwt_validation_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub dss_auth_key: DocumentStorageServiceAuthKey,
    // Shared frecency storage.
    pub frecency_storage: FrecencyPgStorage,
    /// Legacy channel list router state.
    pub channel_list_state: DssChannelListState,
    pub entity_access_service: Arc<EntityAccessService>,
    pub calendar_state: DssCalendarState,
    pub documents_state: DocumentsState,
    pub projects_state: ProjectsState,
    pub channels_state: DssChannelsState,
    /// Shared channel service, for calling channel domain operations outside
    /// the channels router (starter-doc seeding records mention backlinks).
    pub channel_service: Arc<DssChannelService>,
    pub bots_state: DssBotsState,
    pub harnesses_state: DssHarnessesState,
    pub channel_bot_webhook_state: DssChannelBotWebhookState,
    pub call_state: DssCallState,
    pub call_webhook_state: DssCallWebhookState,
    pub webhook_state: DssWebhookState,
    pub sse_stream_state: DssSseStreamState,
    pub call_internal_state: DssCallInternalState,
    pub cal_webhook_state: DssCalWebhookState,
    pub entity_access_management_service: EntityAccessManagementService,
    pub crm_state: DssCrmState,
}

env_var! {
    #[derive(Clone)]
    pub struct DocumentStorageServiceAuthKey;
}

impl From<&ApiContext> for PropertiesHandlerState {
    fn from(ctx: &ApiContext) -> Self {
        PropertiesHandlerState::new(
            ctx.properties_service.clone(),
            ctx.entity_access_service.clone(),
            ctx.authorization_state.clone(),
        )
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
            entity_access_service: ctx.entity_access_service.clone(),
            authorization_state: ctx.authorization_state.clone(),
            calendar_search_enabled: ctx.config.calendar_search_enabled,
        }
    }
}

impl FromRef<ApiContext> for SearchHandlerState {
    fn from_ref(ctx: &ApiContext) -> Self {
        SearchHandlerState::from(ctx)
    }
}

/// `#[derive(FromRef)]` only exposes direct field types, so hand the email
/// router state out of the nested soup router state for email-link extractors
/// that key off `EmailRouterState`.
impl FromRef<ApiContext>
    for email::inbound::axum::previews_router::EmailRouterState<DssEmailService>
{
    fn from_ref(ctx: &ApiContext) -> Self {
        FromRef::from_ref(&ctx.soup_router_state)
    }
}
