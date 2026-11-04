use crate::outbound::email_api::GmailApi;
use crate::util::redis::RedisClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use contacts::domain::service::SqsContactsIngress;
use contacts::outbound::ingress::SqsContactsQueue;
use crm::domain::service::CrmServiceImpl;
use crm::outbound::companies_repo::CompaniesRepositoryImpl;
use crm::outbound::unfurl_resolver::UnfurlCompanyMetadataResolver;
use document_storage_service_client::DocumentStorageServiceClient;
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};
use tokio_util::task::TaskTracker;

/// The event broker used by pubsub workers, with publish tasks tracked for graceful shutdown.
pub type PubSubEventBroker = MacroEventBrokerService<KafkaEventPublisher, TaskTracker>;

/// The concrete notification ingress service type.
pub type NotificationIngressType = SqsNotificationIngress<SqsQueue>;

/// CRM company metadata resolved from the company's public homepage.
pub type CrmMetadataResolver = UnfurlCompanyMetadataResolver<
    unfurl::domain::service::UnfurlServiceImpl<unfurl::outbound::ReqwestUnfurlFetcher>,
>;

/// The concrete CRM service type, backed by Postgres and the
/// homepage-backed [`CrmMetadataResolver`]. The resolver is consulted only
/// on `crm_domain_directory` misses and for pending entries, so it isn't
/// surfaced separately on [`PubSubContext`].
pub type CrmServiceType = CrmServiceImpl<CompaniesRepositoryImpl, CrmMetadataResolver>;

#[derive(Clone)]
pub struct PubSubContext {
    pub gmail_history: email::domain::mailbox::gmail_history::GmailHistoryService<
        email::outbound::mailbox_pg::PgMailboxSync,
    >,
    pub invitation_extractor: crate::pubsub::invitation_extraction::EmailInvitationExtractor,
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub sqs_client: sqs_client::SQS,
    pub contacts_ingress: Arc<SqsContactsIngress<SqsContactsQueue>>,
    pub email_api: GmailApi,
    pub redis_client: RedisClient,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub sfs_client: StaticFileServiceClient,
    pub connection_gateway_client: ConnectionGatewayClient,
    pub dss_client: DocumentStorageServiceClient,
    pub system_properties_service: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    pub crm_service: CrmServiceType,
    pub macro_event_broker: PubSubEventBroker,
    pub notifications_enabled: bool,
    pub retry_worker: bool,
}
