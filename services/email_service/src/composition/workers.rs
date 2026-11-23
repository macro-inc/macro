//! Concrete service types and constructors shared by worker composition.

use crm::domain::service::CrmServiceImpl;
use crm::outbound::companies_repo::CompaniesRepositoryImpl;
use crm::outbound::unfurl_resolver::UnfurlCompanyMetadataResolver;
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
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
/// requested separately by worker effects.
pub type CrmServiceType = CrmServiceImpl<CompaniesRepositoryImpl, CrmMetadataResolver>;

/// Invitation extraction composed with PostgreSQL and the existing Gmail adapter.
pub type EmailInvitationExtractor =
    email::domain::invitation_extraction::InvitationExtractionService<
        email::outbound::invitation_pg::InvitationPgRepository,
        crate::outbound::invitation_extraction::InvitationProvider,
    >;

/// Compose invitation snapshot persistence and provider reads at worker startup.
pub fn invitation_extractor(
    db: sqlx::PgPool,
    provider: crate::outbound::email_api::GmailApi,
) -> EmailInvitationExtractor {
    email::domain::invitation_extraction::InvitationExtractionService {
        repository: email::outbound::invitation_pg::InvitationPgRepository(db),
        provider: crate::outbound::invitation_extraction::InvitationProvider(provider),
    }
}

/// Scheduled delivery composed with its persistence and provider capabilities.
pub type ScheduledDelivery = email::domain::scheduled_delivery::ScheduledDeliveryService<
    crate::outbound::scheduled_delivery::ScheduledDeliveryAdapter,
>;
