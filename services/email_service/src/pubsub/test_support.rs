//! Wiring shared by the tests that run the email workers in process: a fake
//! SQS endpoint, and the production Gmail client, request gate and inbox sync
//! context pointed at fake or emulated HTTP endpoints.

pub mod fake_sqs;

use crate::composition::workers::{CrmMetadataResolver, PubSubEventBroker};
use crate::outbound::email_api::{
    EmailServiceTokenSource, GmailApi, RateBudget, RedisGmailRequestGate,
};
use crate::pubsub::inbox_sync::worker::InboxSyncContext;
use email_api_client::GmailApiClientRepository;
use sqlx::PgPool;
use std::sync::Arc;

pub fn redis_url() -> String {
    std::env::var("REDIS_URI").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string())
}

pub fn redis_client(client: redis::Client) -> crate::util::redis::RedisClient {
    crate::util::redis::RedisClient::new(client, 60)
}

/// Where the production `GmailApi` sends its requests.
pub struct GmailEndpoints<'a> {
    pub gmail: &'a str,
    pub people: &'a str,
    pub certs: &'a str,
    /// The authentication service, which hands out access tokens.
    pub auth: &'a str,
}

/// The production `GmailApi`, with its token source and request gate.
pub async fn gmail_api(
    db: PgPool,
    redis: &redis::Client,
    endpoints: GmailEndpoints<'_>,
    sqs_client: sqs_client::SQS,
) -> GmailApi {
    let client = gmail_client::GmailClient::new_with_urls(
        Some("projects/sim/topics/gmail".to_string()),
        endpoints.gmail.to_string(),
        endpoints.people.to_string(),
        endpoints.certs.to_string(),
        "sim".to_string(),
    );
    GmailApi::new(
        GmailApiClientRepository::new(client),
        EmailServiceTokenSource::new(
            db,
            redis.get_multiplexed_async_connection().await.unwrap(),
            authentication_service_client::AuthServiceClient::new(
                "secret".to_string(),
                endpoints.auth.to_string(),
            ),
            sqs_client,
        ),
        RedisGmailRequestGate::new(
            redis.get_connection_manager().await.unwrap(),
            RateBudget::Live,
        ),
    )
}

/// What the inbox sync workers are wired to.
pub struct InboxSyncWiring<'a> {
    pub db: &'a PgPool,
    pub sqs_sdk: &'a aws_sdk_sqs::Client,
    pub sqs_client: &'a sqs_client::SQS,
    pub email_api: &'a crate::outbound::email_api::GmailApi,
    pub redis: &'a redis::Client,
    pub broker: &'a PubSubEventBroker,
    /// Answers every internal service the worker calls besides SQS.
    pub services_url: &'a str,
}

impl InboxSyncWiring<'_> {
    /// The production inbox sync worker context for the queue at `queue`.
    pub fn context(&self, retry_worker: bool, queue: &str) -> InboxSyncContext {
        let db = self.db.clone();
        let services_url = self.services_url;
        crate::pubsub::inbox_sync::worker::context(
            db.clone(),
            &sqs_worker::SQSWorker::new(self.sqs_sdk.clone(), queue.to_string(), 1, 1),
            self.sqs_client.clone(),
            Arc::new(contacts::domain::service::SqsContactsIngress {
                queue: contacts::outbound::ingress::SqsContactsQueue::new(
                    self.sqs_sdk.clone(),
                    format!("{services_url}/queue/contacts"),
                ),
            }),
            self.email_api.clone(),
            redis_client(self.redis.clone()),
            Arc::new(notification::domain::service::SqsNotificationIngress {
                queue: notification::outbound::queue::SqsQueue::new(
                    self.sqs_sdk.clone(),
                    format!("{services_url}/queue/notifications"),
                ),
            }),
            static_file_service_client::StaticFileServiceClient::new(
                "key".to_string(),
                services_url.to_string(),
            ),
            connection_gateway_client::client::ConnectionGatewayClient::new(
                "key".to_string(),
                services_url.to_string(),
            ),
            document_storage_service_client::DocumentStorageServiceClient::new(
                "key".to_string(),
                services_url.to_string(),
            ),
            Arc::new(system_properties::SystemPropertiesServiceImpl::new(
                system_properties::PgSystemPropertiesRepository::new(db.clone()),
            )),
            crm::domain::service::CrmServiceImpl::new(
                crm::outbound::companies_repo::CompaniesRepositoryImpl::new(db.clone()),
                CrmMetadataResolver::new(Arc::new(
                    unfurl::domain::service::UnfurlServiceImpl::new(
                        unfurl::outbound::ReqwestUnfurlFetcher::new().expect("unfurl fetcher"),
                    ),
                )),
            ),
            self.broker.clone(),
            false,
            retry_worker,
        )
    }
}
