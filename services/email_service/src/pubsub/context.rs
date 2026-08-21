use crate::outbound::email_api::GmailApi;
use crate::pubsub::calendar_backfill_adapters::RedisCalendarRequestGate;
use crate::util::redis::RedisClient;
use calendar_events::{
    domain::models::GoogleWatchConfig,
    domain::service::{GoogleCalendarBackfillCoordinator, GoogleCalendarBackfillFailureService},
    outbound::{google::GoogleCalendarClient, pg::PgCalendarRepository},
};
use connection_gateway_client::client::ConnectionGatewayClient;
use contacts::domain::service::SqsContactsIngress;
use contacts::outbound::ingress::SqsContactsQueue;
use crm::domain::company_metadata_resolver::CompanyMetadataResolver;
use crm::domain::model::DomainMetadata;
use crm::domain::service::CrmServiceImpl;
use crm::outbound::apollo_resolver::ApolloCompanyMetadataResolver;
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

/// Concrete Google Calendar backfill application service.
pub type GoogleCalendarBackfillService = GoogleCalendarBackfillCoordinator<
    PgCalendarRepository,
    GoogleCalendarClient<RedisCalendarRequestGate>,
    PgCalendarRepository,
>;

/// Concrete pre-lease Google Calendar failure application service.
pub type GoogleCalendarBackfillFailureHandler =
    GoogleCalendarBackfillFailureService<PgCalendarRepository>;

/// Calendar application services composed once when a worker starts.
#[derive(Clone)]
pub struct CalendarBackfillServices {
    /// Google provider backfill coordinator.
    pub google: Arc<GoogleCalendarBackfillService>,
    /// Applies terminal provider failures that happen before a lease is claimed.
    pub google_failure: Arc<GoogleCalendarBackfillFailureHandler>,
}

impl CalendarBackfillServices {
    /// Compose calendar application services from process-level adapters.
    pub fn new(db: PgPool, redis_client: RedisClient) -> Self {
        let repository = PgCalendarRepository::new(db);
        Self {
            google: Arc::new(GoogleCalendarBackfillCoordinator::new(
                repository.clone(),
                GoogleCalendarClient::with_gate(
                    reqwest::Client::builder()
                        .timeout(std::time::Duration::from_secs(30))
                        .build()
                        .expect("calendar client configuration is valid"),
                    RedisCalendarRequestGate::new(redis_client),
                ),
                repository.clone(),
                calendar_watch_config(),
            )),
            google_failure: Arc::new(GoogleCalendarBackfillFailureService::new(repository)),
        }
    }
}

/// Push notification channels are opened only when both optional watch
/// variables are configured; without them the 5-minute poll is the sole
/// freshness mechanism.
pub fn calendar_watch_config() -> Option<GoogleWatchConfig> {
    // A variable set to an empty string must count as unset: a blank token
    // would verify blank-header webhook requests.
    let read = |name| {
        macro_env_var::maybe_read_env(name)
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    };
    let address = read("CALENDAR_WATCH_WEBHOOK_URL")?;
    let token = read("CALENDAR_WATCH_TOKEN")?;
    Some(GoogleWatchConfig { address, token })
}

/// The unfurl-backed resolver used when Apollo enrichment is disabled.
type UnfurlResolver = UnfurlCompanyMetadataResolver<
    unfurl::domain::service::UnfurlServiceImpl<unfurl::outbound::ReqwestUnfurlFetcher>,
>;

/// CRM company-metadata resolver, chosen at startup from the
/// `USE_APOLLO_CRM_ENRICHMENT` flag: Apollo.io when enabled, the
/// unfurl-backed resolver otherwise. A single concrete type so it slots
/// into [`CrmServiceType`] — `CompanyMetadataResolver` is RPITIT and thus
/// not dyn-compatible, so we dispatch via an enum rather than `dyn`.
#[derive(Clone)]
pub enum CrmMetadataResolver {
    /// Apollo.io organization enrichment.
    Apollo(ApolloCompanyMetadataResolver),
    /// Unfurl-backed homepage metadata.
    Unfurl(UnfurlResolver),
}

impl CompanyMetadataResolver for CrmMetadataResolver {
    async fn resolve(&self, domain: &str) -> DomainMetadata {
        match self {
            CrmMetadataResolver::Apollo(r) => r.resolve(domain).await,
            CrmMetadataResolver::Unfurl(r) => r.resolve(domain).await,
        }
    }
}

/// The concrete CRM service type, backed by Postgres and the
/// flag-selected [`CrmMetadataResolver`]. The resolver is consulted only
/// on `crm_domain_directory` misses, so it isn't surfaced separately on
/// [`PubSubContext`].
pub type CrmServiceType = CrmServiceImpl<CompaniesRepositoryImpl, CrmMetadataResolver>;

#[derive(Clone)]
pub struct PubSubContext {
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
    pub calendar_sync_enabled: bool,
    pub retry_worker: bool,
    pub calendar_backfills: CalendarBackfillServices,
}
