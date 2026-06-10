use crate::config::Config;
use crate::service::ai_stream_registry::AiStreamRegistry;
use ai_tools::{
    AiToolSet, ToolCallToolContext, ToolDocumentService, ToolDocumentToolContext, ToolEmailService,
    ToolEmailToolContext, ToolEntityAccessService, ToolPropertiesToolContext, ToolServiceContext,
    ToolSoupService,
};
use attachment::provider::AttachmentProvider;
use axum::extract::FromRef;
use chat::domain::service::MessageServiceImpl;
use chat::inbound::attachment::ChatAttachmentService;
use chat::outbound::postgres::PgChatRepo;
use comms::inbound::attachment::CommsAttachmentService;
use comms::outbound::postgres::comms_repo::PgCommsRepo;
use connection_gateway::service::connection::ConnectionRepo;
use document_storage_service_client::DocumentStorageServiceClient;
use documents::inbound::attachment::DocumentAttachmentService;
use email::inbound::attachment::EmailAttachmentService;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use notification::outbound::websocket::ConnectionGatewayClient;
use search_service_client::SearchServiceClient;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use static_file::inbound::attachment::StaticFileAttachmentService;
use static_file::outbound::CdnStaticFileRepo;
use std::sync::{Arc, OnceLock};
use stream::domain::StreamRepo;

/// Type alias for the entity access service.
pub type DcsEntityAccessService = EntityAccessServiceImpl<PgAccessRepository>;

/// Type alias for the attachment provider wired to concrete DCS services.
pub type DcsAttachmentProvider = AttachmentProvider<
    DocumentAttachmentService<ToolDocumentService, ToolEntityAccessService>,
    EmailAttachmentService<ToolEmailService, ToolEntityAccessService>,
    ChatAttachmentService<PgChatRepo, ToolEntityAccessService>,
    CommsAttachmentService<PgCommsRepo, ToolEntityAccessService>,
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

/// Concrete MCP router state for DCS.
pub type DcsMcpRouterState = mcp_client::inbound::McpRouterState<
    mcp_client::outbound::pg_server_repo::PgServerRepo,
    mcp_client::domain::service::OAuthService<
        mcp_client::outbound::pg_server_repo::PgServerRepo,
        mcp_client::outbound::redis_state_store::RedisOAuthStateStore,
    >,
>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub db: PgPool,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub document_storage_client: Arc<DocumentStorageServiceClient>,
    pub search_service_client: Arc<SearchServiceClient>,
    pub email_service_client_external: Arc<email_service_client::EmailServiceClientExternal>,
    pub jwt_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub connection_repo: Arc<dyn ConnectionRepo>,
    pub connection_gateway_client: Arc<ConnectionGatewayClient>,
    pub soup_service: Arc<ToolSoupService>,
    pub email_service: Arc<ToolEmailService>,
    pub stream_repo: Arc<dyn StreamRepo>,
    pub document_tool_context: ToolDocumentToolContext,
    pub memory_service: Arc<DcsMemoryService>,
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

pub static GLOBAL_CONTEXT: OnceLock<ApiContext> = OnceLock::new();
