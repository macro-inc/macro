//! Shared composition for the HTTP API and background workers.

use crate::outbound::{
    email_api::{GmailApi, MicrosoftCredentialsClient},
    inbox_health::{PgInboxHealth, ProviderInboxHealth},
};
use email::{
    domain::mailbox::{credentials::MailboxCredentials, health::InboxHealthService},
    outbound::mailbox_pg::PgMailboxSync,
};
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use tokio_util::task::TaskTracker;

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
    ProviderInboxHealth<MicrosoftTokens, MacroEventBrokerService<KafkaEventPublisher, TaskTracker>>,
>;

pub fn inbox_health(
    db: sqlx::PgPool,
    gmail: GmailApi,
    auth: authentication_service_client::AuthServiceClient,
    redis: crate::util::redis::RedisClient,
    queue: sqs_client::SQS,
    broker: MacroEventBrokerService<KafkaEventPublisher, TaskTracker>,
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
        },
    )
}
