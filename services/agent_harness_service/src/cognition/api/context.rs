use crate::cognition::config::Config;
use crate::cognition::service::ai_stream_registry::AiStreamRegistry;
use ai_tools::{
    AiToolSet, ToolCallToolContext, ToolDocumentService, ToolDocumentToolContext, ToolEmailService,
    ToolEmailToolContext, ToolEntityAccessService, ToolPropertiesToolContext, ToolServiceContext,
    ToolSoupService,
};
use attachment::provider::AttachmentProvider;
use axum::extract::FromRef;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use channels::inbound::attachment::ChannelAttachmentService;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use chat::domain::service::MessageServiceImpl;
use chat::inbound::attachment::ChatAttachmentService;
use chat::outbound::postgres::PgChatRepo;
use connection_gateway::service::connection::ConnectionRepo;
use document_storage_service_client::DocumentStorageServiceClient;
use documents::inbound::attachment::DocumentAttachmentService;
use email::inbound::attachment::EmailAttachmentService;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use entity_registry::NonUserOwners;
use macro_auth::InternalApiKey;
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use notification::outbound::websocket::ConnectionGatewayClient;
use search_service_client::SearchServiceClient;
use sqlx::PgPool;
use static_file::inbound::attachment::StaticFileAttachmentService;
use static_file::outbound::CdnStaticFileRepo;
use std::sync::{Arc, OnceLock};
use stream::domain::StreamRepo;

/// Type alias for the entity access service.
pub type DcsEntityAccessService = EntityAccessServiceImpl<PgAccessRepository>;

/// Type alias for the authorization service.
pub type DcsAuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

/// Type alias for the roles-and-permissions service backed by MacroDB.
pub type DcsUserPermissionsService =
    roles_and_permissions::domain::service::UserRolesAndPermissionsServiceImpl<
        roles_and_permissions::outbound::pgpool::MacroDB,
    >;

/// The AI billing gate: reads plan allowances, credits, and overage state.
/// DCS never charges anyone.
pub type DcsAiBillingService = ai_billing::domain::BillingServiceImpl<
    ai_billing::outbound::RolesTeamsEntitlementSource<
        DcsUserPermissionsService,
        teams::outbound::team_repo::TeamRepositoryImpl,
    >,
    ai_billing::outbound::PgUsageReader,
    ai_billing::outbound::PgBillingRepo,
    ai_billing::outbound::HttpPaymentGateway,
>;

/// Type alias for the chat model entitlement extractor wired to DCS services.
pub type DcsChatModelAccess = chat::inbound::http::extractors::ChatModelAccess<
    DcsAuthorizationService,
    DcsUserPermissionsService,
>;

/// Type alias for the attachment provider wired to concrete DCS services.
pub type DcsAttachmentProvider = AttachmentProvider<
    DocumentAttachmentService<ToolDocumentService, ToolEntityAccessService>,
    EmailAttachmentService<ToolEmailService, ToolEntityAccessService>,
    ChatAttachmentService<PgChatRepo<PgBotsRepo>, ToolEntityAccessService>,
    ChannelAttachmentService<PgChannelsRepo, ToolEntityAccessService>,
    StaticFileAttachmentService<CdnStaticFileRepo>,
>;

/// Kafka-backed event broker with publish tasks tracked for graceful shutdown.
pub type DcsEventBroker = macro_event_broker::MacroEventBrokerService<
    macro_event_broker::KafkaEventPublisher,
    tokio_util::task::TaskTracker,
>;

/// Type alias for the message service wired to concrete DCS services.
pub type DcsMessageService =
    MessageServiceImpl<PgChatRepo<PgBotsRepo>, DcsAttachmentProvider, DcsEventBroker>;

#[cfg(test)]
pub(crate) mod test;
#[cfg(test)]
pub use test::test_api_context;
pub(crate) type NotificationIngressType = SqsNotificationIngress<SqsQueue>;

pub type DcsMemoryService =
    memory::domain::service::MemoryServiceImpl<memory::outbound::pg_memory_repo::PgMemoryRepo>;

/// The AI cost service wired to the Postgres usage repo.
pub type DcsUsageService =
    ai_usage::domain::service::UsageServiceImpl<ai_usage::outbound::PgUsageRepo>;

/// The `/connectors` routes' state over the process's connectors.
pub type DcsConnectorsRouterState = connectors::inbound::axum_router::ConnectorsRouterState<
    connectors::domain::service::Connectors,
    connectors::composition::ConnectorCatalog,
    DcsAuthorizationService,
>;

/// The public callback routes' state over the process's server sign-ins.
pub type DcsCallbacksState =
    connectors::inbound::callbacks::CallbacksState<connectors::domain::sign_in::ServerSignIns>;

/// The import pipeline service, shared between the import router and the
/// chat toolset.
pub type DcsImportService = ai_tools::ToolImportService;

/// The onboarding orchestrator wired to the Postgres repo and the connectors.
pub type DcsOnboardingService = onboarding::domain::service::OnboardingServiceImpl<
    onboarding::outbound::pg_onboarding_repo::PgOnboardingRepo,
    connectors::domain::service::Connectors,
>;

/// Redis-backed rate limiting for the web routes.
pub type WebRateLimiter =
    rate_limit::RateLimitServiceImpl<rate_limit::RedisRateLimitAdapter<redis::Client>>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub db: PgPool,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub document_storage_client: Arc<DocumentStorageServiceClient>,
    pub search_service_client: Arc<SearchServiceClient>,
    pub email_service_client_external: Arc<email_service_client::EmailServiceClientExternal>,
    pub authorization_state: MacroAuthorizationState<DcsAuthorizationService>,
    pub user_permissions_service: Arc<DcsUserPermissionsService>,
    /// Whether a team bot with no acting user may own what it creates.
    pub non_user_owners: NonUserOwners,
    /// Plan allowance gate for AI requests.
    pub ai_billing: Arc<DcsAiBillingService>,
    /// Shared admission for new AI operations, after authorization.
    pub ai_admission: Arc<dyn ai_billing::AiAdmissionService>,
    /// General named decisions, with admission and metering in the Jev domain.
    pub decisions: Arc<dyn jev::domain::decisions::DecisionService>,
    /// Bounded, one-call completions without discovery or an agent loop.
    pub tool_free_completions:
        Arc<dyn crate::cognition::service::structured_completion::ToolFreeCompletion>,
    pub config: Arc<Config>,
    pub internal_api_key: InternalApiKey,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub connection_repo: Arc<dyn ConnectionRepo>,
    pub connection_gateway_client: Arc<ConnectionGatewayClient>,
    pub soup_service: Arc<ToolSoupService>,
    pub email_service: Arc<ToolEmailService>,
    pub stream_repo: Arc<dyn StreamRepo>,
    pub document_tool_context: ToolDocumentToolContext,
    pub memory_service: Arc<DcsMemoryService>,
    pub usage_service: Arc<DcsUsageService>,
    pub properties_tool_context: ToolPropertiesToolContext,
    pub email_tool_context: ToolEmailToolContext,
    pub call_tool_context: ToolCallToolContext,
    pub tool_service_context: ToolServiceContext,
    pub all_tools: Arc<AiToolSet>,
    pub all_tools_prompt: Arc<dyn std::fmt::Display + Send + Sync>,
    pub entity_access_service: Arc<DcsEntityAccessService>,
    pub message_service: Arc<DcsMessageService>,
    pub ai_stream_registry: AiStreamRegistry,
    /// Per-user limit on `/web/search` and `/web/fetch`.
    pub web_rate_limiter: WebRateLimiter,
    pub connectors_state: DcsConnectorsRouterState,
    pub callbacks_state: DcsCallbacksState,
    /// The process's connections, already decided by the rules: chat loads
    /// a user's MCP tools through them.
    pub connectors: connectors::domain::service::Connectors,
    pub granola_sync: Option<Arc<dyn granola_sync::domain::service::SyncService>>,
    pub import_service: Arc<DcsImportService>,
    pub onboarding_service: Arc<DcsOnboardingService>,
    /// Kafka-backed macro event broker for publishing domain events.
    pub macro_event_broker: DcsEventBroker,
}

impl FromRef<ApiContext>
    for chat::inbound::http::extractors::UserPermissionsState<DcsUserPermissionsService>
{
    fn from_ref(state: &ApiContext) -> Self {
        chat::inbound::http::extractors::UserPermissionsState(
            state.user_permissions_service.clone(),
        )
    }
}

pub static GLOBAL_CONTEXT: OnceLock<ApiContext> = OnceLock::new();
