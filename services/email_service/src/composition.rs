//! Shared composition for the HTTP API and background workers.

use crate::outbound::{
    email_api::{GmailApi, MicrosoftCredentialsClient},
    inbox_health::{PgInboxHealth, ProviderInboxHealth},
};
use contacts::{domain::service::SqsContactsIngress, outbound::ingress::SqsContactsQueue};
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
    ProviderInboxHealth<
        MicrosoftTokens,
        MacroEventBrokerService<KafkaEventPublisher, TaskTracker>,
        SqsContactsIngress<SqsContactsQueue>,
    >,
>;

pub fn inbox_health(
    db: sqlx::PgPool,
    gmail: GmailApi,
    auth: authentication_service_client::AuthServiceClient,
    redis: crate::util::redis::RedisClient,
    queue: sqs_client::SQS,
    broker: MacroEventBrokerService<KafkaEventPublisher, TaskTracker>,
    contacts: std::sync::Arc<SqsContactsIngress<SqsContactsQueue>>,
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

pub type PersonProfiles = email::domain::person_profiles::PersonProfileService<
    email::outbound::person_profiles_pg::PersonProfilePgRepository,
    email::outbound::apollo_person_resolver::ApolloPersonProfileResolver,
>;

/// Looks people up with Apollo only when enabled and a key is configured;
/// otherwise serves stored profiles.
pub fn person_profiles(
    db: sqlx::PgPool,
    enabled: bool,
    apollo_api_key: Option<&str>,
) -> anyhow::Result<PersonProfiles> {
    let resolver = match apollo_api_key.filter(|key| enabled && !key.is_empty()) {
        Some(key) => Some(
            email::outbound::apollo_person_resolver::ApolloPersonProfileResolver::new(
                key.to_string(),
            )?,
        ),
        None => None,
    };
    Ok(email::domain::person_profiles::PersonProfileService::new(
        email::outbound::person_profiles_pg::PersonProfilePgRepository(db),
        resolver,
    ))
}

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
