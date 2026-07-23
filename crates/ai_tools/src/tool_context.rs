use anthropic::toolset::AnthropicToolContext;
use axum::extract::FromRef;
use call::domain::models::{CallError, CallWebhookEvent, EgressS3Config};
use call::domain::ports::CallRtcClient;
use call::domain::service::{CallRecordQueryServiceImpl, CallServiceImpl};
use call::inbound::toolset::CallToolContext;
use call::outbound::pg_call_repo::PgCallRepo;
use call::outbound::s3_recording_storage::S3RecordingStorage;
use channels::domain::ports::ChannelEventDispatcher;
use channels::domain::service::{NoopChannelEventDispatcher, NoopChannelReferenceSharePermissions};
use channels::domain::{list_service::ChannelListServiceImpl, service::ChannelServiceImpl};
use channels::inbound::toolset::ChannelToolContext;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use chat::domain::service::ChatServiceImpl;
use chat::inbound::toolset::ChatToolContext;
use chat::outbound::postgres::PgChatRepo;
use connection::domain::ports::ConnectionService;
use crm::inbound::toolset::CrmToolContext;
use documents::{domain::ports::TaskPropertiesPort, inbound::toolset::DocumentToolContext};
use email::{
    domain::service::EmailServiceImpl, inbound::toolset::EmailToolContext, outbound::EmailPgRepo,
};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService as _;
use foreign_entity::{
    domain::service::ForeignEntityServiceImpl,
    outbound::pg_foreign_entity_repo::PgForeignEntityRepo,
};
use lexical_mention_extractor::LexicalMentionExtractor;
use macro_user_id::user_id::MacroUserIdStr;
use notification::inbound::ai_tool::NotificationToolContext;
use properties::inbound::toolset::PropertiesToolContext;
use soup::{domain::service::SoupImpl, inbound::toolset::SoupToolContext};
use std::sync::Arc;
use system_properties::{
    PgSystemPropertiesRepository, PriorityOption, StatusOption, SystemPropertiesService as _,
    SystemPropertiesServiceImpl,
};
use teams::{inbound::toolset::TeamToolContext, outbound::team_repo::TeamRepositoryImpl};

pub use ai_toolset::RequestContext;

/// Type alias for the frecency service implementation
pub type ToolFrecencyService = frecency::domain::services::FrecencyQueryServiceImpl<
    frecency::outbound::postgres::FrecencyPgStorage,
>;

/// Type alias for the CRM service implementation used by tools.
///
/// Tools only read CRM rows; the populate path runs in the email-service
/// pubsub worker. The no-op resolver keeps reqwest/scraper out of the
/// tool binary at the cost of a silent negative cache if populate is
/// ever invoked here.
pub type ToolCrmService = crm::domain::service::CrmServiceImpl<
    crm::outbound::companies_repo::CompaniesRepositoryImpl,
    crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
>;

/// Type alias for the entity access management service implementation.
pub type ToolEamService =
    entity_access_management::domain::service::EntityAccessManagementServiceImpl<
        entity_access_management::outbound::PgRepository,
    >;

/// Type alias for the email service implementation
pub type ToolEmailService = EmailServiceImpl<
    EmailPgRepo,
    ToolFrecencyService,
    email::domain::ports::NoOpEnqueuer,
    ToolCrmService,
    ToolEamService,
>;

/// Type alias for the send-capable email service implementation used by user
/// tools. Carries the real event broker: these tools mutate email state, and
/// the Gmail-echo suppression means events skipped here are never recovered.
pub type ToolUserEmailService = EmailServiceImpl<
    EmailPgRepo,
    ToolFrecencyService,
    sqs_client::SQS,
    ToolCrmService,
    ToolEamService,
    macro_event_broker::MacroEventBrokerService<macro_event_broker::KafkaEventPublisher>,
>;

/// Type alias for the channel list service implementation.
pub type ToolCommsService = ChannelListServiceImpl<
    PgChannelsRepo,
    PgChannelsRepo,
    frecency::outbound::postgres::FrecencyPgStorage,
>;

/// A channel event dispatcher injected into the tool service. Defaults to a
/// no-op; hosts that own the realtime/notification clients (e.g. the
/// document-storage service running the Macro agent) inject a real
/// side-effect-wired dispatcher so agent-sent messages notify and broadcast.
pub type ToolChannelEventDispatcher = std::sync::Arc<dyn ChannelEventDispatcher>;

/// Type alias for the channel messages service implementation used by AI tools.
pub type ToolChannelMessagesService = ChannelServiceImpl<
    PgChannelsRepo,
    ToolChannelEventDispatcher,
    NoopChannelReferenceSharePermissions,
    LexicalMentionExtractor,
>;

/// Type alias for the channel AI tool context.
pub type ToolChannelToolContext =
    ChannelToolContext<ToolChannelMessagesService, ToolEntityAccessService>;

/// Build the channel AI tool context from a Postgres pool, with no side
/// effects (no notifications/realtime) for hosts that lack those clients.
/// `lexical_client` derives the mention list for messages the agent sends,
/// since bot-authored content arrives without the editor-tracked mentions.
pub fn build_channel_tool_context(
    pool: sqlx::PgPool,
    lexical_client: Arc<lexical_client::LexicalClient>,
) -> ToolChannelToolContext {
    build_channel_tool_context_with_dispatcher(
        pool,
        std::sync::Arc::new(NoopChannelEventDispatcher),
        lexical_client,
    )
}

/// Build the channel AI tool context wired to `dispatcher`, so messages sent by
/// agent tools fire the host's channel side effects (notifications, realtime,
/// search indexing).
pub fn build_channel_tool_context_with_dispatcher(
    pool: sqlx::PgPool,
    dispatcher: ToolChannelEventDispatcher,
    lexical_client: Arc<lexical_client::LexicalClient>,
) -> ToolChannelToolContext {
    ChannelToolContext::new(
        ChannelServiceImpl::with_dependencies(
            PgChannelsRepo::new(pool.clone()),
            dispatcher,
            NoopChannelReferenceSharePermissions,
        )
        .with_mention_extractor(LexicalMentionExtractor::new(lexical_client)),
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool),
        ),
    )
}

/// Type alias for the CRM AI tool context.
pub type ToolCrmToolContext =
    CrmToolContext<ToolCrmService, ToolEntityAccessService, ToolPropertiesService>;

/// Build the CRM AI tool context from a Postgres pool.
pub fn build_crm_tool_context(pool: sqlx::PgPool) -> ToolCrmToolContext {
    let entity_access_service = Arc::new(
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool.clone()),
        ),
    );
    let properties = build_properties_service(pool.clone(), entity_access_service.clone());
    CrmToolContext {
        service: Arc::new(crm::domain::service::CrmServiceImpl::new(
            crm::outbound::companies_repo::CompaniesRepositoryImpl::new(pool.clone()),
            crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
        )),
        entity_access_service,
        properties,
    }
}

/// Type alias for the team member listing service used by AI tools.
pub type ToolTeamService = TeamRepositoryImpl;

/// Type alias for the team AI tool context.
pub type ToolTeamToolContext = TeamToolContext<ToolTeamService, ToolEntityAccessService>;

/// Build the team repository used for roster lookups (e.g. resolving
/// imported items' emails to teammates).
pub fn build_team_repository(pool: sqlx::PgPool) -> Arc<ToolTeamService> {
    Arc::new(TeamRepositoryImpl::new(pool))
}

/// Build the team AI tool context from a Postgres pool.
pub fn build_team_tool_context(pool: sqlx::PgPool) -> ToolTeamToolContext {
    TeamToolContext::new(
        TeamRepositoryImpl::new(pool.clone()),
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool),
        ),
    )
}

/// No-op task properties service for tests and contexts that do not create tasks.
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

/// Adapter implementing [`TaskPropertiesPort`] with the real properties services.
#[derive(Clone)]
pub struct TaskPropertiesAdapter {
    /// System properties service used to attach/copy task property rows.
    pub system_properties: Arc<ToolSystemPropertiesService>,
    /// Properties service used to assign concrete task property values.
    pub properties: Arc<ToolPropertiesService>,
    /// Canonical entity access service used to authorize task property writes.
    pub entity_access_service: Arc<ToolEntityAccessService>,
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

        let user_id = macro_user_id::user_id::MacroUserIdStr::parse_from_str(user_id)?;
        let entity_access_receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &user_id,
                None,
                entity_id,
                model_entity::EntityType::Document,
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
        self.system_properties
            .copy_task_properties(from_task_id, to_task_id)
            .await
            .map_err(Into::into)
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

    async fn build_voip_push_payloads<'a>(
        &self,
        _request: call::domain::models::VoipPushPayloadRequest<'a>,
    ) -> Vec<(
        MacroUserIdStr<'static>,
        notification::domain::models::apple::VoipPushPayload,
    )> {
        Vec::new()
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

    fn verify_access_token(
        &self,
        _token: &str,
    ) -> anyhow::Result<call::domain::models::VerifiedRingToken> {
        anyhow::bail!("call RTC client not configured")
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

/// No-op SNS endpoint manager used by AI notification tools.
///
/// The exposed AI tools list and update notifications. Updating notifications
/// can clear existing push notifications via the notification delivery queue,
/// but it does not create or mutate SNS platform endpoints. Device
/// registration APIs are not exposed through the AI toolset, so SNS endpoint
/// operations intentionally fail if called accidentally.
#[derive(Clone)]
pub struct NoOpSnsEndpointManager;

impl notification::domain::ports::SnsEndpointManager for NoOpSnsEndpointManager {
    async fn create_platform_endpoint(
        &self,
        _platform_arn: &str,
        _token: &str,
    ) -> Result<String, rootcause::Report> {
        rootcause::bail!("SNS endpoint manager not configured for AI tools")
    }

    async fn get_endpoint_attributes(
        &self,
        _endpoint_arn: &str,
    ) -> Result<std::collections::HashMap<String, String>, rootcause::Report> {
        rootcause::bail!("SNS endpoint manager not configured for AI tools")
    }

    async fn set_endpoint_attributes(
        &self,
        _endpoint_arn: &str,
        _attributes: std::collections::HashMap<String, String>,
    ) -> Result<(), rootcause::Report> {
        rootcause::bail!("SNS endpoint manager not configured for AI tools")
    }

    async fn delete_endpoint(&self, _endpoint_arn: &str) -> Result<(), rootcause::Report> {
        rootcause::bail!("SNS endpoint manager not configured for AI tools")
    }
}

/// Notification delivery queue used by AI tools.
///
/// Most production contexts provide the real notification SQS queue so marking
/// notifications seen/done can clear mobile pushes. Some auxiliary binaries
/// that expose the shared tool context do not have a notification queue
/// configured; those can use `NoOp`, which still updates database state but
/// skips push-clearing delivery messages.
#[derive(Clone)]
pub enum ToolNotificationQueue {
    Sqs(notification::outbound::queue::SqsQueue),
    NoOp,
}

impl notification::domain::ports::NotificationQueue for ToolNotificationQueue {
    async fn publish<'a, T: serde::Serialize + Send + Sync, U: serde::Serialize + Send + Sync>(
        &self,
        messages: Vec<notification::domain::models::queue_message::QueueMessage<'a, T, U>>,
    ) -> Result<(), rootcause::Report> {
        match self {
            ToolNotificationQueue::Sqs(queue) => {
                notification::domain::ports::NotificationQueue::publish(queue, messages).await
            }
            ToolNotificationQueue::NoOp => Ok(()),
        }
    }

    async fn receive_messages(
        &self,
    ) -> Result<Vec<notification::domain::models::queue_message::RawQueueMessage>, rootcause::Report>
    {
        match self {
            ToolNotificationQueue::Sqs(queue) => {
                notification::domain::ports::NotificationQueue::receive_messages(queue).await
            }
            ToolNotificationQueue::NoOp => Ok(Vec::new()),
        }
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), rootcause::Report> {
        match self {
            ToolNotificationQueue::Sqs(queue) => {
                notification::domain::ports::NotificationQueue::delete_message(
                    queue,
                    receipt_handle,
                )
                .await
            }
            ToolNotificationQueue::NoOp => Ok(()),
        }
    }

    async fn delay_message(
        &self,
        receipt_handle: &str,
        delay: std::time::Duration,
    ) -> Result<(), rootcause::Report> {
        match self {
            ToolNotificationQueue::Sqs(queue) => {
                notification::domain::ports::NotificationQueue::delay_message(
                    queue,
                    receipt_handle,
                    delay,
                )
                .await
            }
            ToolNotificationQueue::NoOp => Ok(()),
        }
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
    TaskPropertiesAdapter,
    NoOpConnectionService,
    ToolEntityAccessManagementService,
    ToolForeignEntityService,
    macro_event_broker::MacroEventBrokerService<macro_event_broker::KafkaEventPublisher>,
>;

/// Type alias for the entity access service implementation
pub type ToolEntityAccessService = entity_access::domain::service::EntityAccessServiceImpl<
    entity_access::outbound::PgAccessRepository,
>;

/// Type alias for the document tool context
pub type ToolDocumentToolContext = DocumentToolContext<
    ToolDocumentService,
    ToolEntityAccessService,
    documents::outbound::editing_worker_client::ReqwestEditingWorkerClient,
>;

/// Type alias for the foreign entity service implementation used by AI tools.
pub type ToolForeignEntityService = ForeignEntityServiceImpl<PgForeignEntityRepo>;

/// Type alias for the soup service implementation
pub type ToolSoupService = SoupImpl<
    soup::outbound::pg_soup_repo::PgSoupRepo,
    ToolFrecencyService,
    email::domain::ports::ReadonlyEmailPreviewAdapter<ToolEmailService>,
    ToolCommsService,
    ToolCallRecordQueryService,
    crm::domain::service::NoOpCrmService,
    ToolForeignEntityService,
>;

/// No-op notification service for properties (tools don't send assignment notifications)
#[derive(Clone)]
pub struct NoOpNotificationService;

impl properties::NotificationService for NoOpNotificationService {
    type Err = anyhow::Error;

    async fn send_task_assigned<'a>(
        &self,
        _notification: properties::domain::model::TaskAssignedNotification<'a>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}

/// Type alias for the system properties service implementation used by AI tools.
pub type ToolSystemPropertiesService = SystemPropertiesServiceImpl<PgSystemPropertiesRepository>;

/// Type alias for the properties service implementation used by AI tools
pub type ToolPropertiesService = properties::PropertiesServiceImpl<
    properties::PropertiesPgRepo,
    properties::PermissionServiceImpl<ToolEntityAccessService>,
    NoOpNotificationService,
>;

/// Type alias for the properties tool context
pub type ToolPropertiesToolContext =
    PropertiesToolContext<ToolPropertiesService, ToolEntityAccessService>;

/// Build the properties service shared by the properties tools and task adapter.
pub fn build_properties_service(
    pool: sqlx::PgPool,
    entity_access_service: Arc<ToolEntityAccessService>,
) -> Arc<ToolPropertiesService> {
    Arc::new(properties::PropertiesServiceImpl::new(
        properties::PropertiesPgRepo::new(pool.clone()),
        Some(properties::PermissionServiceImpl::new(
            pool,
            entity_access_service,
        )),
        Some(NoOpNotificationService),
    ))
}

/// Build the real task properties adapter used by document creation tools.
pub fn build_task_properties_adapter(
    pool: sqlx::PgPool,
    properties: Arc<ToolPropertiesService>,
    entity_access_service: Arc<ToolEntityAccessService>,
) -> TaskPropertiesAdapter {
    TaskPropertiesAdapter {
        system_properties: Arc::new(SystemPropertiesServiceImpl::new(
            PgSystemPropertiesRepository::new(pool),
        )),
        properties,
        entity_access_service,
    }
}

/// Build a properties tool context from shared domain and access services.
pub fn build_properties_tool_context(
    properties: Arc<ToolPropertiesService>,
    entity_access_service: Arc<ToolEntityAccessService>,
) -> ToolPropertiesToolContext {
    PropertiesToolContext {
        service: properties,
        entity_access_service,
    }
}

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
pub type ToolCallToolContext = CallToolContext<ToolCallService, ToolEntityAccessService>;

/// Type alias for the notification reader service used by AI tools.
pub type ToolNotificationService = notification::domain::service::NotificationReaderService<
    notification::outbound::repository::DbNotificationRepository<sqlx::PgPool>,
    ToolNotificationQueue,
    NoOpSnsEndpointManager,
>;

/// Type alias for the notification tool context.
pub type ToolNotificationToolContext = NotificationToolContext<ToolNotificationService>;

/// Type alias for the chat service implementation used by AI tools.
/// Uses an empty toolset — the read-only tool never invokes tool execution.
pub type ToolChatService = ChatServiceImpl<PgChatRepo, (), ToolEntityAccessManagementService>;

/// Type alias for the chat tool context
pub type ToolChatToolContext = ChatToolContext<ToolChatService, ToolEntityAccessService>;

/// Creates the Macro entities the import pipeline's fixed mapping calls for
/// (linear → task, notion → md, slack → channel), reusing the same document
/// creator and channel service the other AI tools run on. Task system
/// properties (status, priority, due date, assignee) and channel teammate
/// invites are applied best-effort — an enrichment that fails never fails
/// the import itself.
#[derive(Clone)]
pub struct ToolEntityCreator {
    /// Backend-owned document creation use case (shared with document tools).
    pub document_creator:
        documents::inbound::toolset::DefaultDocumentToolCreator<ToolDocumentService>,
    /// Team lookup so imported tasks get the user's team task numbering.
    pub entity_access_service: Arc<ToolEntityAccessService>,
    /// Channel creation service.
    pub channel_service: Arc<ToolChannelMessagesService>,
    /// Task system-property writes (status / priority / due date / assignees).
    pub task_properties: TaskPropertiesAdapter,
    /// Team roster lookups, to resolve source-tool emails to teammates.
    pub team_repository: Arc<ToolTeamService>,
}

impl ToolEntityCreator {
    async fn create_doc(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        markdown: &str,
        is_task: bool,
        team_id: Option<uuid::Uuid>,
    ) -> anyhow::Result<String> {
        use std::str::FromStr as _;
        let document = documents::domain::create::NewPlainTextDocument::builder(
            documents::domain::create::NewDocumentMetadata::new(name.to_string()),
        )
        .file_type(model::document::FileType::from_str("md").expect("md is a valid file type"))
        .text(markdown.to_string())
        .task_flag(is_task, team_id)
        .build()?;
        let created = self
            .document_creator
            .create_plain_text(user.clone(), document)
            .await?;
        Ok(created
            .into_response()
            .document_response
            .document_metadata
            .metadata
            .document_id
            .to_string())
    }

    /// The user's team id (when they have one) and its member ids.
    async fn team_roster(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> (Option<uuid::Uuid>, Vec<MacroUserIdStr<'static>>) {
        use teams::domain::team_repo::TeamRepository as _;
        let team_id = match self.entity_access_service.get_user_team(user).await {
            Ok(team) => team.map(|team| team.team_id),
            Err(e) => {
                tracing::warn!(%user, error = ?e, "failed to get user's team");
                None
            }
        };
        let Some(team_id) = team_id else {
            return (None, Vec::new());
        };
        match self.team_repository.get_team_members(&team_id).await {
            Ok(members) => (
                Some(team_id),
                members
                    .into_iter()
                    .map(|member| macro_user_id::cowlike::CowLike::into_owned(member.user_id))
                    .collect(),
            ),
            Err(e) => {
                tracing::warn!(%user, %team_id, error = ?e, "failed to list team members");
                (Some(team_id), Vec::new())
            }
        }
    }

    /// Apply imported task properties best-effort: each one logs and is
    /// skipped on failure so a bad label or unknown assignee never sinks
    /// the import.
    async fn apply_task_properties(
        &self,
        user: &MacroUserIdStr<'static>,
        task_id: &str,
        properties: &import::domain::ports::ImportedTaskProperties,
        roster: &[MacroUserIdStr<'static>],
    ) {
        use models_properties::api::requests::SetPropertyValue;
        use system_properties::SystemPropertyKey;

        if let Some(status) = properties.status.as_deref()
            && let Err(e) = self
                .task_properties
                .update_task_status(task_id, status)
                .await
        {
            tracing::warn!(task_id, status, error = ?e, "failed to set imported task status");
        }

        if let Some(priority) = properties.priority.as_deref() {
            let option = match priority {
                "Low" => Some(PriorityOption::Low),
                "Medium" => Some(PriorityOption::Medium),
                "High" => Some(PriorityOption::High),
                "Urgent" => Some(PriorityOption::Urgent),
                _ => None,
            };
            match option {
                Some(option) => {
                    if let Err(e) = self
                        .task_properties
                        .set_entity_property(
                            user.as_ref(),
                            task_id,
                            SystemPropertyKey::Priority.uuid(),
                            Some(SetPropertyValue::SelectOption {
                                option_id: option.uuid(),
                            }),
                        )
                        .await
                    {
                        tracing::warn!(task_id, priority, error = ?e, "failed to set imported task priority");
                    }
                }
                None => tracing::warn!(task_id, priority, "unknown imported task priority label"),
            }
        }

        if let Some(due_date) = properties.due_date.as_deref() {
            match chrono::NaiveDate::parse_from_str(due_date, "%Y-%m-%d") {
                Ok(date) => {
                    let value = date.and_time(chrono::NaiveTime::MIN).and_utc();
                    if let Err(e) = self
                        .task_properties
                        .set_entity_property(
                            user.as_ref(),
                            task_id,
                            SystemPropertyKey::DueDate.uuid(),
                            Some(SetPropertyValue::Date { value }),
                        )
                        .await
                    {
                        tracing::warn!(task_id, due_date, error = ?e, "failed to set imported task due date");
                    }
                }
                Err(e) => {
                    tracing::warn!(task_id, due_date, error = ?e, "unparseable imported task due date");
                }
            }
        }

        if let Some(email) = properties.assignee_email.as_deref() {
            // Only assign teammates — an email with no roster match (an
            // external collaborator, a bot) is silently skipped.
            let Some(assignee) = roster
                .iter()
                .find(|member| member.email_str().eq_ignore_ascii_case(email))
            else {
                return;
            };
            let reference = models_properties::EntityReference::new(
                assignee.as_ref().to_string(),
                models_properties::EntityType::User,
            );
            if let Err(e) = self
                .task_properties
                .set_entity_property(
                    user.as_ref(),
                    task_id,
                    SystemPropertyKey::Assignees.uuid(),
                    Some(SetPropertyValue::MultiEntityReference {
                        references: vec![reference],
                    }),
                )
                .await
            {
                tracing::warn!(task_id, email, error = ?e, "failed to set imported task assignee");
            }
        }
    }
}

impl import::domain::ports::EntityCreator for ToolEntityCreator {
    async fn create_task(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        markdown: &str,
        properties: &import::domain::ports::ImportedTaskProperties,
    ) -> anyhow::Result<String> {
        // Same team resolution as the CreateDocument tool, so imported tasks
        // number correctly within the user's team; the roster doubles as the
        // assignee-email lookup.
        let (team_id, roster) = self.team_roster(user).await;
        let task_id = self.create_doc(user, name, markdown, true, team_id).await?;
        self.apply_task_properties(user, &task_id, properties, &roster)
            .await;
        Ok(task_id)
    }

    async fn create_markdown_doc(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        markdown: &str,
    ) -> anyhow::Result<String> {
        self.create_doc(user, name, markdown, false, None).await
    }

    async fn create_channel(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        team_id: Option<uuid::Uuid>,
        participant_emails: &[String],
    ) -> anyhow::Result<String> {
        use channels::domain::ports::ChannelService as _;
        // Teammates who were in the source channel join the Macro one; emails
        // with no roster match (external collaborators, bots) are skipped.
        let (_, roster) = self.team_roster(user).await;
        let mut participants: std::collections::HashSet<MacroUserIdStr<'static>> =
            std::iter::once(user.clone()).collect();
        for email in participant_emails {
            if let Some(member) = roster
                .iter()
                .find(|member| member.email_str().eq_ignore_ascii_case(email))
            {
                participants.insert(member.clone());
            }
        }
        let request = channels::domain::models::CreateChannelRequest {
            name: Some(name.to_string()),
            channel_type: if team_id.is_some() {
                channels::domain::models::ChannelType::Team
            } else {
                channels::domain::models::ChannelType::Public
            },
            team_id,
            // The creator is always included (the service requires a
            // non-empty participant list and the repo filters out the
            // owner), plus any teammates matched by email above. Explicit
            // membership mirrors the source channel — never the whole team.
            auto_join_team: false,
            participants,
        };
        let response = self
            .channel_service
            .create_channel(
                channels::domain::models::Sender::new_from_user(user.clone()),
                None,
                request,
            )
            .await
            .map_err(|e| anyhow::anyhow!("failed to create channel: {e:?}"))?;
        Ok(response.id)
    }
}

/// Type alias for the import service implementation used by AI tools.
pub type ToolImportService = import::domain::service::ImportServiceImpl<
    import::outbound::pg_import_repo::PgImportRepo,
    mcp_client::outbound::pg_server_repo::PgServerRepo,
    ToolEntityCreator,
>;

/// Type alias for the import tool context. Built `unwired` by the shared
/// context builder; hosts that can run the import pipeline (DCS) replace it
/// with a wired one after constructing the import service.
pub type ToolImportToolContext = import::inbound::toolset::ImportToolContext<ToolImportService>;

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
    pub notification_tool_context: ToolNotificationToolContext,
    /// Import staging/tracking tools. `unwired` in hosts that can't build
    /// the import service — calls there fail with a clear error.
    pub import_tool_context: ToolImportToolContext,
    /// Built per-request via a manual `FromRef` below so it can carry the
    /// running chat's id — the derive's field-clone would freeze it at
    /// startup with no chat id set.
    #[from_ref(skip)]
    pub chat_tool_context: ToolChatToolContext,
    pub channel_tool_context: ToolChannelToolContext,
    pub team_tool_context: ToolTeamToolContext,
    pub crm_tool_context: ToolCrmToolContext,
    pub schedule_tool_context: NoOpScheduleContext,
    pub anthropic_tool_context: AnthropicToolContext,
    /// Records token usage / cost for AI calls made with this context.
    pub recorder: std::sync::Arc<dyn ai_usage::UsageRecorder>,
    /// The usage context (feature/user/entity) of the request currently using
    /// this context. Set per-session by the caller so AI calls made by tools
    /// (e.g. subagents) are attributed to the feature that spawned them.
    pub usage_context: ai_usage::UsageContext,
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
            self_chat_id: self_chat_id(ctx),
        }
    }
}

impl FromRef<ToolServiceContext> for ToolChatToolContext {
    fn from_ref(ctx: &ToolServiceContext) -> Self {
        ChatToolContext {
            service: ctx.chat_tool_context.service.clone(),
            entity_access_service: ctx.chat_tool_context.entity_access_service.clone(),
            self_chat_id: self_chat_id(ctx),
        }
    }
}

/// Entity id of the chat this request belongs to, when the request is an
/// interactive chat session. `None` for every other feature, in which case
/// nothing about the running chat should be excluded/blocked.
fn self_chat_id(ctx: &ToolServiceContext) -> Option<uuid::Uuid> {
    matches!(ctx.usage_context.feature, ai_usage::AiFeature::Chat)
        .then_some(ctx.usage_context.entity)
        .flatten()
}
