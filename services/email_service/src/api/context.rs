use crate::calendar_refresh::ConnectionGatewayCalendarRefresh;
use crate::calendar_request_gate::RedisCalendarRequestGate;
use crate::calendar_tokens::CalendarTokenProviderAdapter;
use axum::extract::FromRef;
use calendar_events::{
    domain::{mutations::CalendarMutationServiceImpl, service::CalendarService},
    outbound::{google::GoogleCalendarClient, pg::PgCalendarRepository},
};
use document_storage_service_client::DocumentStorageServiceClient;
use email::{
    domain::service::EmailServiceImpl,
    inbound::axum::{
        axum_impls::GmailTokenState, get_thread_router::EmailThreadRouterState,
        previews_router::EmailRouterState,
    },
    outbound::{EmailPgRepo, GmailTokenProviderImpl},
};

use crate::config::Config;
use crate::outbound::email_api::GmailApi;
use crate::outbound::mailbox_init::{MicrosoftGrantSource, PgMailboxInitialization};
use crate::util::redis::RedisClient;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use entity_access_management::domain::service::EntityAccessManagementServiceImpl;
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::InternalApiKey;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};
use tokio_util::task::TaskTracker;

pub(crate) type AuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;
pub(crate) type CalendarGrantService = CalendarService<PgCalendarRepository>;
pub(crate) type CalendarMutationSvc = CalendarMutationServiceImpl<
    PgCalendarRepository,
    calendar_events::domain::providers::CalendarProviders<
        GoogleCalendarClient<RedisCalendarRequestGate>,
        email_api_client::OutlookApiClientRepository,
    >,
    CalendarTokenProviderAdapter,
    EmailEventBroker,
    ConnectionGatewayCalendarRefresh,
>;
pub(crate) type EmailEntityAccessService = EntityAccessServiceImpl<PgAccessRepository>;
pub(crate) type EmailEntityAccessManagementService =
    EntityAccessManagementServiceImpl<entity_access_management::outbound::PgRepository>;
pub(crate) type EmailEventBroker = MacroEventBrokerService<KafkaEventPublisher, TaskTracker>;
pub(crate) type MailboxInitializer =
    email::domain::mailbox::initialization::MailboxInitializationService<
        PgMailboxInitialization,
        MicrosoftGrantSource,
    >;
pub(crate) type EmailSvc = EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    sqs_client::SQS,
    crm::domain::service::CrmServiceImpl<
        crm::outbound::companies_repo::CompaniesRepositoryImpl,
        crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
    >,
    EmailEntityAccessManagementService,
    EmailEventBroker,
>;

pub(crate) type DraftAttachmentSvc = email::domain::draft_attachments::DraftAttachmentService<
    EmailPgRepo,
    crate::outbound::draft_attachment_storage::DraftAttachmentS3,
    EmailEntityAccessService,
>;

pub(crate) type MicrosoftTokens = email::domain::mailbox::credentials::MailboxCredentials<
    email::outbound::mailbox_pg::PgMailboxSync,
    crate::outbound::email_api::MicrosoftCredentialsClient,
>;

pub(crate) type OutlookApi = email_api_client::domain::service::mailbox::MailboxApiService<
    email_api_client::OutlookApiClientRepository,
    MicrosoftTokens,
    email_api_client::domain::ports::AlwaysAllowRateLimiter,
>;
pub(crate) type AttachmentReadSvc = email::domain::attachment_access::AttachmentReadService<
    EmailPgRepo,
    crate::outbound::attachment_access::ProviderAttachmentBytes<
        crate::outbound::email_api::ProviderMailboxGateway<
            email_api_client::OutlookApiClientRepository,
            MicrosoftTokens,
            email_api_client::domain::ports::AlwaysAllowRateLimiter,
        >,
    >,
    crate::outbound::attachment_access::MailAttachmentFiles,
    EmailEntityAccessService,
>;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub mailbox_notifications: Arc<
        email::domain::mailbox::watches::MailboxWatchNotifications<
            email::outbound::mailbox_pg::PgMailboxSync,
        >,
    >,

    pub mailbox_settings: Arc<
        email::domain::mailbox::settings::MailboxSettingsService<
            email::outbound::mailbox_pg::PgMailboxSync,
            crate::outbound::mailbox_settings::ProviderMailboxSettings<
                email_api_client::OutlookApiClientRepository,
                MicrosoftTokens,
                email_api_client::domain::ports::AlwaysAllowRateLimiter,
            >,
        >,
    >,

    pub inbox_lifecycle: Arc<crate::composition::InboxLifecycle>,
    pub inbox_catalog: Arc<
        email::domain::mailbox::catalog::InboxCatalogService<
            crate::outbound::inbox_catalog::PgInboxCatalog,
        >,
    >,
    pub inbox_health: Arc<crate::composition::InboxHealth>,
    pub attachment_reads: Arc<AttachmentReadSvc>,
    pub draft_attachments: Arc<DraftAttachmentSvc>,
    pub draft_transfers: Arc<
        email::domain::draft_transfer::DraftTransferService<
            EmailPgRepo,
            crate::outbound::draft_attachment_storage::DraftAttachmentS3,
        >,
    >,
    pub mailbox_initializer: Arc<MailboxInitializer>,
    pub invitation_snapshots: email::outbound::invitation_pg::InvitationPgRepository,
    pub invitation_resolver: Arc<
        calendar_events::domain::invitations::CalendarInvitationResolver<
            calendar_events::outbound::pg::PgCalendarRepository,
        >,
    >,
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub auth_service_client: Arc<authentication_service_client::AuthServiceClient>,
    // The raw client is retained only for Gmail webhook JWKS/JWT authentication.
    pub gmail_client: Arc<gmail_client::GmailClient>,
    pub email_api: GmailApi,
    pub redis_client: Arc<RedisClient>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub s3_client: Arc<s3_client::S3>,
    pub sfs_client: Arc<StaticFileServiceClient>,
    pub dss_client: Arc<DocumentStorageServiceClient>,
    pub system_properties_service: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub jwt_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub internal_api_key: InternalApiKey,
    pub email_service: EmailRouterState<EmailSvc>,
    pub entity_access_service: Arc<EmailEntityAccessService>,
    pub email_thread_state:
        EmailThreadRouterState<EmailSvc, EmailEntityAccessService, AuthorizationService>,
    pub gmail_token_state: GmailTokenState<GmailTokenProviderImpl>,
    pub macro_event_broker: Arc<EmailEventBroker>,
    pub calendar_service: Arc<CalendarGrantService>,
    pub calendar_mutation_service: Arc<CalendarMutationSvc>,
}
