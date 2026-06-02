use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
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
use gmail_client::GmailClient;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};

/// The concrete notification ingress service type.
pub type NotificationIngressType = SqsNotificationIngress<SqsQueue>;

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
    pub gmail_client: GmailClient,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub sfs_client: StaticFileServiceClient,
    pub connection_gateway_client: ConnectionGatewayClient,
    pub dss_client: DocumentStorageServiceClient,
    pub system_properties_service: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    pub crm_service: CrmServiceType,
    pub notifications_enabled: bool,
    pub retry_worker: bool,
}
