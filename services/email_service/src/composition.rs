//! Shared composition for the HTTP API and background workers.

pub(crate) mod api;
pub mod workers;

use crate::outbound::{
    email_api::{GmailApi, MicrosoftCredentialsClient},
    inbox_health::{PgInboxHealth, ProviderInboxHealth},
};
use contacts::{
    domain::{
        list_writes::{ContactListWrites, ListWritesGate},
        service::SqsContactsIngress,
    },
    outbound::ingress::SqsContactsQueue,
};
use email::{
    domain::mailbox::{credentials::MailboxCredentials, health::InboxHealthService},
    outbound::mailbox_pg::PgMailboxSync,
};
use feature_flags::outbound::posthog::PostHogFeatureFlags;
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use tokio_util::task::TaskTracker;

/// The contacts queue every email path publishes through: legacy messages
/// always, list-aware ones only once `contacts-list-writes` is on.
pub type ContactsProducer =
    ListWritesGate<SqsContactsIngress<SqsContactsQueue>, PostHogFeatureFlags>;

/// The contacts producer for `queue_url`. `flags` is `None` without a PostHog
/// key, which leaves list-aware messages off outside a local stack.
pub fn contacts_producer(
    sqs: aws_sdk_sqs::Client,
    queue_url: String,
    environment: macro_env::Environment,
    flags: Option<PostHogFeatureFlags>,
) -> ContactsProducer {
    ListWritesGate {
        inner: SqsContactsIngress {
            queue: SqsContactsQueue::new(sqs, queue_url),
        },
        writes: ContactListWrites::new(environment, flags),
    }
}

pub type InboxLifecycle = email::domain::mailbox::lifecycle::InboxLifecycleService<
    PgMailboxSync,
    crate::outbound::inbox_lifecycle::InboxLifecycleClients,
>;
pub fn inbox_lifecycle(
    outlook: email_api_client::OutlookApiClientRepository,
    db: sqlx::PgPool,
    auth: authentication_service_client::AuthServiceClient,
    queue: sqs_client::SQS,
    gateway: connection_gateway_client::client::ConnectionGatewayClient,
) -> InboxLifecycle {
    email::domain::mailbox::lifecycle::InboxLifecycleService::new(
        PgMailboxSync::new(db),
        crate::outbound::inbox_lifecycle::InboxLifecycleClients {
            outlook,
            auth,
            queue,
            gateway,
        },
    )
}

pub type MicrosoftTokens = MailboxCredentials<PgMailboxSync, MicrosoftCredentialsClient>;
pub type InboxHealth = InboxHealthService<
    PgInboxHealth,
    ProviderInboxHealth<
        MicrosoftTokens,
        MacroEventBrokerService<KafkaEventPublisher, TaskTracker>,
        ContactsProducer,
    >,
>;

pub fn inbox_health(
    db: sqlx::PgPool,
    gmail: GmailApi,
    auth: authentication_service_client::AuthServiceClient,
    redis: crate::util::redis::RedisClient,
    queue: sqs_client::SQS,
    broker: MacroEventBrokerService<KafkaEventPublisher, TaskTracker>,
    contacts: std::sync::Arc<ContactsProducer>,
) -> InboxHealth {
    InboxHealthService::new(
        PgInboxHealth {
            db: db.clone(),
            redis,
            queue: queue.clone(),
        },
        ProviderInboxHealth {
            gmail,
            outlook: MicrosoftTokens::new(
                PgMailboxSync::new(db.clone()),
                MicrosoftCredentialsClient(auth),
            ),
            db,
            queue,
            broker,
            contacts,
        },
    )
}

pub type ReadReceipts = email::domain::read_receipts::ReadReceiptService<
    email::outbound::read_receipts_pg::ReadReceiptPgRepository,
>;

/// Pixels point at this service's public URL, which serves `/opens/{token}`.
pub fn read_receipts(
    db: sqlx::PgPool,
    environment: macro_env::Environment,
) -> anyhow::Result<ReadReceipts> {
    let base = macro_service_urls::EmailServiceUrl::new_for_environment(environment)?;
    Ok(email::domain::read_receipts::ReadReceiptService::new(
        email::outbound::read_receipts_pg::ReadReceiptPgRepository(db),
        email::domain::read_receipts::PixelUrlPrefix::new(base.as_str()),
    ))
}
