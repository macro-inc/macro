use crate::config::Config;
use ai_tools::{
    AiToolSet, ToolDocumentToolContext, ToolEmailService, ToolEmailToolContext,
    ToolPropertiesToolContext, ToolServiceContext, ToolSoupService,
};
use axum::extract::FromRef;
use connection_gateway::service::connection::ConnectionRepo;
use document_storage_service_client::DocumentStorageServiceClient;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use scribe::{
    ScribeClient, channel::ChannelClient, dcs::DcsClient, document::DocumentClient,
    email::EmailClient, static_file::StaticFileClient,
};
use search_service_client::SearchServiceClient;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::{Arc, OnceLock};
use stream::domain::StreamRepo;

/// Type alias for the entity access service.
pub type DcsEntityAccessService = EntityAccessServiceImpl<PgAccessRepository>;

#[cfg(test)]
mod test;
#[cfg(test)]
pub use test::*;

pub type DcsScribe =
    ScribeClient<DocumentClient, ChannelClient, DcsClient, EmailClient, StaticFileClient>;

pub(crate) type NotificationIngressType = SqsNotificationIngress<SqsQueue>;

pub type DcsMemoryService =
    memory::domain::service::MemoryServiceImpl<memory::outbound::pg_memory_repo::PgMemoryRepo>;

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
    pub email_service: Arc<ToolEmailService>,
    pub stream_repo: Arc<dyn StreamRepo>,
    pub document_tool_context: ToolDocumentToolContext,
    pub memory_service: Arc<DcsMemoryService>,
    pub properties_tool_context: ToolPropertiesToolContext,
    pub email_tool_context: ToolEmailToolContext,
    pub tool_service_context: ToolServiceContext,
    pub all_tools: Arc<AiToolSet>,
    pub all_tools_prompt: &'static str,
    pub entity_access_service: Arc<DcsEntityAccessService>,
}

pub static GLOBAL_CONTEXT: OnceLock<ApiContext> = OnceLock::new();
