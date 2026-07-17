use crate::config::Config;
use crate::service::ai_stream_registry::AiStreamRegistry;
use ai_tools::{
    AiToolSet, ToolCallToolContext, ToolDocumentService, ToolDocumentToolContext, ToolEmailService,
    ToolEmailToolContext, ToolEntityAccessService, ToolPropertiesToolContext, ToolServiceContext,
    ToolSoupService,
};
use attachment::provider::AttachmentProvider;
use axum::extract::FromRef;
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
        roles_and_permissions::outbound::pgpool::MacroDB,
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
    ChatAttachmentService<PgChatRepo, ToolEntityAccessService>,
    ChannelAttachmentService<PgChannelsRepo, ToolEntityAccessService>,
    StaticFileAttachmentService<CdnStaticFileRepo>,
>;

/// Type alias for the message service wired to concrete DCS services.
pub type DcsMessageService = MessageServiceImpl<PgChatRepo, DcsAttachmentProvider>;

#[cfg(test)]
mod test;
#[cfg(test)]
pub use test::test_api_context;
pub(crate) type NotificationIngressType = SqsNotificationIngress<SqsQueue>;

pub type DcsMemoryService =
    memory::domain::service::MemoryServiceImpl<memory::outbound::pg_memory_repo::PgMemoryRepo>;

/// The AI cost service wired to the Postgres usage repo.
pub type DcsUsageService =
    ai_usage::domain::service::UsageServiceImpl<ai_usage::outbound::PgUsageRepo>;

/// The AI projections service wired to the Postgres projection repo, the SQS
/// materialization queue, and the connection-gateway update notifier.
pub type DcsAiProjectionService =
    ai_projections::domain::ai_projection_service::AiProjectionServiceImpl<
        ai_projections::outbound::ai_projection_repo::AiProjectionRepositoryImpl,
        sqs_client::SQS,
        ai_projections::outbound::agent_generator::AgentProjectionGenerator,
        ai_projections::outbound::gateway_notifier::GatewayProjectionNotifier,
    >;

/// Concrete MCP router state for DCS.
pub type DcsMcpRouterState = mcp_client::inbound::McpRouterState<
    mcp_client::outbound::pg_server_repo::PgServerRepo,
    mcp_client::domain::service::OAuthService<
        mcp_client::outbound::pg_server_repo::PgServerRepo,
        mcp_client::outbound::redis_state_store::RedisOAuthStateStore,
    >,
    DcsAuthorizationService,
>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub db: PgPool,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub document_storage_client: Arc<DocumentStorageServiceClient>,
    pub search_service_client: Arc<SearchServiceClient>,
    pub email_service_client_external: Arc<email_service_client::EmailServiceClientExternal>,
    pub authorization_state: MacroAuthorizationState<DcsAuthorizationService>,
    pub user_permissions_service: Arc<DcsUserPermissionsService>,
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
    pub ai_projections_service: Arc<DcsAiProjectionService>,
    pub properties_tool_context: ToolPropertiesToolContext,
    pub email_tool_context: ToolEmailToolContext,
    pub call_tool_context: ToolCallToolContext,
    pub tool_service_context: ToolServiceContext,
    pub all_tools: Arc<AiToolSet>,
    pub all_tools_prompt: Arc<dyn std::fmt::Display + Send + Sync>,
    pub entity_access_service: Arc<DcsEntityAccessService>,
    pub message_service: Arc<DcsMessageService>,
    pub ai_stream_registry: AiStreamRegistry,
    pub mcp_state: DcsMcpRouterState,
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
