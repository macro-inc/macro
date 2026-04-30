use axum::extract::FromRef;
use call::domain::models::{CallError, CallWebhookEvent, EgressS3Config};
use call::domain::ports::CallRtcClient;
use call::domain::service::{CallRecordQueryServiceImpl, CallServiceImpl};
use call::inbound::toolset::CallToolContext;
use call::outbound::pg_call_repo::PgCallRepo;
use call::outbound::s3_recording_storage::S3RecordingStorage;
use channels::domain::service::ChannelMessagesServiceImpl;
use channels::inbound::toolset::ChannelToolContext;
use channels::outbound::pg_channels_repo::PgChannelMessagesRepo;
use chat::domain::service::ChatServiceImpl;
use chat::inbound::toolset::ChatToolContext;
use chat::outbound::postgres::PgChatRepo;
use connection::domain::ports::ConnectionService;
use documents::{domain::ports::TaskPropertiesPort, inbound::toolset::DocumentToolContext};
use email::{
    domain::service::EmailServiceImpl, inbound::toolset::EmailToolContext, outbound::EmailPgRepo,
};
use macro_user_id::user_id::MacroUserIdStr;
use properties::inbound::toolset::PropertiesToolContext;
use soup::{domain::service::SoupImpl, inbound::toolset::SoupToolContext};
use std::sync::Arc;

pub use ai_toolset::RequestContext;

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

/// Type alias for the channel messages service implementation used by AI tools.
pub type ToolChannelMessagesService = ChannelMessagesServiceImpl<PgChannelMessagesRepo>;

/// Type alias for the channel AI tool context.
pub type ToolChannelToolContext =
    ChannelToolContext<ToolChannelMessagesService, ToolEntityAccessService>;

/// Build the channel AI tool context from a Postgres pool.
pub fn build_channel_tool_context(pool: sqlx::PgPool) -> ToolChannelToolContext {
    ChannelToolContext::new(
        ChannelMessagesServiceImpl::new(PgChannelMessagesRepo::new(pool.clone())),
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool),
        ),
    )
}

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

/// No-op RTC client used by the call tool context — the AI read-only tools
/// never touch RTC, so token/egress methods bail rather than silently succeed.
#[derive(Clone)]
pub struct NoOpCallRtcClient;

impl CallRtcClient for NoOpCallRtcClient {
    async fn create_room(&self, _room_name: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn delete_room(&self, _room_name: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn generate_token<'a>(
        &self,
        _room_name: &str,
        _participant_identity: MacroUserIdStr<'a>,
    ) -> anyhow::Result<String> {
        anyhow::bail!("call RTC client not configured")
    }

    async fn remove_participant<'a>(
        &self,
        _room_name: &str,
        _participant_identity: MacroUserIdStr<'a>,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    async fn start_room_composite_egress(
        &self,
        _room_name: &str,
        _s3_config: &EgressS3Config,
    ) -> anyhow::Result<String> {
        anyhow::bail!("call RTC client not configured")
    }

    async fn stop_egress(&self, _egress_id: &str) -> anyhow::Result<()> {
        Ok(())
    }

    fn receive_webhook(
        &self,
        _body: &str,
        _auth_token: &str,
    ) -> Result<CallWebhookEvent, CallError> {
        Err(CallError::Auth)
    }

    async fn dispatch_transcription_agent(&self, _room_name: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

/// No-op notification ingress used by the call tool context — reads never
/// push notifications.
#[derive(Clone)]
pub struct NoOpNotificationIngress;

impl notification::domain::service::NotificationIngress for NoOpNotificationIngress {
    async fn send_notification<
        'a,
        T: notification::domain::models::Notification + Clone + 'static,
        U: serde::Serialize + Send + Sync + 'static,
    >(
        &'a self,
        _req: notification::domain::models::SendNotificationRequest<'a, T, U>,
    ) -> Result<
        Option<notification::domain::models::NotificationResult<'a>>,
        rootcause::Report<notification::domain::service::SendNotificationError>,
    > {
        Ok(None)
    }
}

/// Type alias for the entity access management service implementation used by AI tools
pub type ToolEntityAccessManagementService =
    entity_access_management::domain::service::EntityAccessManagementServiceImpl<
        entity_access_management::outbound::PgRepository,
    >;

/// Type alias for the document service implementation used by AI tools
pub type ToolDocumentService = documents::domain::service::DocumentServiceImpl<
    documents::outbound::pg_document_repo::PgDocumentRepo,
    documents::outbound::s3_upload_url::S3UploadUrlAdapter,
    NoOpTaskProperties,
    NoOpConnectionService,
    ToolEntityAccessManagementService,
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

/// Type alias for the call service implementation used by AI tools.
/// Wired with NoOp RTC/connection/notification clients and no recording
/// storage — the AI tools are read-only, so those capabilities are never
/// exercised.
pub type ToolCallService = CallServiceImpl<
    PgCallRepo,
    NoOpCallRtcClient,
    NoOpConnectionService,
    ToolEntityAccessService,
    NoOpNotificationIngress,
    Option<S3RecordingStorage>,
>;

/// Type alias for the read-only call record query service.
pub type ToolCallRecordQueryService = CallRecordQueryServiceImpl<PgCallRepo>;

/// Type alias for the call tool context
pub type ToolCallToolContext =
    CallToolContext<ToolCallService, ToolCallRecordQueryService, ToolEntityAccessService>;

/// Type alias for the chat service implementation used by AI tools.
/// Uses an empty toolset — the read-only tool never invokes tool execution.
pub type ToolChatService = ChatServiceImpl<PgChatRepo, (), ToolEntityAccessManagementService>;

/// Type alias for the chat tool context
pub type ToolChatToolContext = ChatToolContext<ToolChatService, ToolEntityAccessService>;

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
    pub soup_service: Arc<ToolSoupService>,
    pub email_service: Arc<ToolEmailService>,
    pub document_tool_context: ToolDocumentToolContext,
    pub properties_tool_context: ToolPropertiesToolContext,
    pub email_tool_context: ToolEmailToolContext,
    pub call_tool_context: ToolCallToolContext,
    pub chat_tool_context: ToolChatToolContext,
    pub channel_tool_context: ToolChannelToolContext,
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
