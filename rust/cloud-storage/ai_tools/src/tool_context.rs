use axum::extract::FromRef;
use connection::domain::ports::ConnectionService;
use documents::{domain::ports::TaskPropertiesPort, inbound::toolset::DocumentToolContext};
use email::{
    domain::service::EmailServiceImpl, inbound::toolset::EmailToolContext, outbound::EmailPgRepo,
};
use macro_user_id::user_id::MacroUserIdStr;
use properties::inbound::toolset::PropertiesToolContext;
use scribe::{
    ScribeClient, channel::ChannelClient, dcs::DcsClient, document::DocumentClient,
    email::EmailClient, static_file::StaticFileClient,
};
use soup::{domain::service::SoupImpl, inbound::toolset::SoupToolContext};
use std::sync::Arc;

pub use ai_toolset::RequestContext;

pub type ToolScribe =
    ScribeClient<DocumentClient, ChannelClient, DcsClient, EmailClient, StaticFileClient>;

/// Type alias for the frecency service implementation
pub type ToolFrecencyService = frecency::domain::services::FrecencyQueryServiceImpl<
    frecency::outbound::postgres::FrecencyPgStorage,
>;

/// Type alias for the email service implementation
pub type ToolEmailService =
    EmailServiceImpl<EmailPgRepo, ToolFrecencyService, email::domain::ports::NoOpEnqueuer>;

/// Type alias for the send-capable email service implementation used by user tools.
pub type ToolUserEmailService = EmailServiceImpl<EmailPgRepo, ToolFrecencyService, sqs_client::SQS>;

/// Type alias for the comms/channels service implementation
pub type ToolCommsService = comms::domain::service::ChannelServiceImpl<
    comms::outbound::postgres::comms_repo::PgCommsRepo,
    comms::outbound::postgres::user_repo::PgUserRepo,
    frecency::outbound::postgres::FrecencyPgStorage,
>;

/// No-op task properties service (not needed for AI tools)
#[derive(Clone)]
pub struct NoOpTaskProperties;

impl TaskPropertiesPort for NoOpTaskProperties {
    async fn update_task_status(&self, _entity_id: &str, _status: &str) -> anyhow::Result<()> {
        Ok(())
    }
    async fn attach_task_properties(&self, _entity_ids: Vec<String>) -> anyhow::Result<()> {
        Ok(())
    }
    async fn set_entity_property(
        &self,
        _user_id: &str,
        _entity_id: &str,
        _property_definition_id: uuid::Uuid,
        _value: Option<models_properties::api::requests::SetPropertyValue>,
    ) -> anyhow::Result<()> {
        Ok(())
    }
    async fn copy_task_properties(
        &self,
        _from_task_id: &str,
        _to_task_id: &str,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

/// No-op connection service
#[derive(Clone)]
pub struct NoOpConnectionService;

impl ConnectionService for NoOpConnectionService {
    async fn send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        _invalidation_event: connection::domain::models::InvalidationEvent<'a, T>,
    ) -> Result<(), connection::domain::models::ConnectionError> {
        Ok(())
    }

    async fn send_channel_message<'a>(
        &self,
        _users: &[MacroUserIdStr<'a>],
        _message_type: &str,
        _message: serde_json::Value,
    ) -> Result<(), connection::domain::models::ConnectionError> {
        Ok(())
    }
}

/// Type alias for the document service implementation used by AI tools
pub type ToolDocumentService = documents::domain::service::DocumentServiceImpl<
    documents::outbound::pg_document_repo::PgDocumentRepo,
    documents::outbound::s3_upload_url::S3UploadUrlAdapter,
    NoOpTaskProperties,
    NoOpConnectionService,
>;

/// Type alias for the entity access service implementation
pub type ToolEntityAccessService = entity_access::domain::service::EntityAccessServiceImpl<
    entity_access::outbound::PgAccessRepository,
>;

/// Type alias for the document tool context
pub type ToolDocumentToolContext =
    DocumentToolContext<ToolDocumentService, ToolEntityAccessService>;

/// Type alias for the soup service implementation
pub type ToolSoupService = SoupImpl<
    soup::outbound::pg_soup_repo::PgSoupRepo,
    ToolFrecencyService,
    email::domain::ports::ReadonlyEmailPreviewAdapter<ToolEmailService>,
    ToolCommsService,
    call::domain::ports::NoOpCallRecordQueryService,
>;

/// No-op notification service for properties (tools don't send assignment notifications)
#[derive(Clone)]
pub struct NoOpNotificationService;

impl properties::NotificationService for NoOpNotificationService {
    type Err = anyhow::Error;

    async fn send_notification<'a>(
        &self,
        _message: notification::domain::models::SendNotificationRequest<
            'a,
            model_notifications::TaskAssignedMetadata,
            notification::domain::models::apple::PushNotificationData,
        >,
    ) -> Result<uuid::Uuid, Self::Err> {
        Ok(uuid::Uuid::nil())
    }
}

/// Type alias for the properties service implementation used by AI tools
pub type ToolPropertiesService = properties::PropertiesServiceImpl<
    properties::PropertiesPgRepo,
    properties::PermissionServiceImpl<ToolEntityAccessService>,
    NoOpNotificationService,
>;

/// Type alias for the properties tool context
pub type ToolPropertiesToolContext = PropertiesToolContext<ToolPropertiesService>;

/// Type alias for the email tool context
pub type ToolEmailToolContext = EmailToolContext<ToolUserEmailService>;

#[derive(Clone, Default)]
pub struct NoOpScheduleContext;

#[cfg(any(test, feature = "test-support"))]
pub fn no_op_schedule_context() -> NoOpScheduleContext {
    NoOpScheduleContext
}

/// The full service context containing all API clients.
/// Individual tools should extract only the clients they need via `FromRef`.
#[derive(Clone, FromRef)]
pub struct ToolServiceContext {
    pub search_service_client: Arc<search_service_client::SearchServiceClient>,
    pub email_service_client: Arc<email_service_client::EmailServiceClientExternal>,
    pub scribe: Arc<ToolScribe>,
    pub soup_service: Arc<ToolSoupService>,
    pub email_service: Arc<ToolEmailService>,
    pub document_tool_context: ToolDocumentToolContext,
    pub properties_tool_context: ToolPropertiesToolContext,
    pub email_tool_context: ToolEmailToolContext,
    pub schedule_tool_context: NoOpScheduleContext,
}

impl FromRef<ToolServiceContext> for ai_toolset::NoContext {
    fn from_ref(_ctx: &ToolServiceContext) -> Self {
        ai_toolset::NoContext()
    }
}

impl FromRef<ToolServiceContext> for SoupToolContext<ToolSoupService, ToolEmailService> {
    fn from_ref(ctx: &ToolServiceContext) -> Self {
        SoupToolContext {
            service: ctx.soup_service.clone(),
            email_service: ctx.email_service.clone(),
        }
    }
}
