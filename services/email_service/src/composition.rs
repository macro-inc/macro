//! Shared composition for the HTTP API and background workers.

pub(crate) mod api;
pub mod workers;

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

/// Build the IMAP gateway once at a composition root.
pub fn imap_gateway(
    db: sqlx::PgPool,
    internal_key: &str,
) -> anyhow::Result<crate::outbound::email_api::imap::ImapMailboxGateway> {
    let url = macro_service_urls::ImapServiceUrl::new()?;
    Ok(crate::outbound::email_api::imap::ImapMailboxGateway {
        client: imap_service_client::ImapServiceClient::new(
            url.to_string(),
            internal_key.to_owned(),
        )?,
        health: PgMailboxSync::new(db).with_provider(email::domain::models::UserProvider::Imap),
    })
}

/// Construct the shared flag loader; a missing project key fails the rollout closed.
pub fn imap_enrollment(
    config: &crate::config::Config,
) -> anyhow::Result<crate::outbound::imap_connection::ImapEnrollment> {
    let flags = config
        .posthog_api_key()
        .map(|key| {
            feature_flags::outbound::posthog::PostHogFeatureFlags::new(
                config
                    .posthog_host
                    .value()
                    .unwrap_or("https://us.i.posthog.com"),
                key.to_owned(),
                std::time::Duration::from_secs(3),
                config.environment,
            )
        })
        .transpose()
        .map_err(|error| anyhow::anyhow!("invalid IMAP rollout configuration: {error}"))?;
    Ok(crate::outbound::imap_connection::ImapEnrollment(flags))
}

pub type InboxLifecycle = email::domain::mailbox::lifecycle::InboxLifecycleService<
    PgMailboxSync,
    crate::outbound::inbox_lifecycle::InboxLifecycleClients,
>;
pub fn inbox_lifecycle(
    imap: imap_service_client::ImapServiceClient,
    outlook: email_api_client::OutlookApiClientRepository,
    db: sqlx::PgPool,
    auth: authentication_service_client::AuthServiceClient,
    queue: sqs_client::SQS,
    gateway: connection_gateway_client::client::ConnectionGatewayClient,
) -> InboxLifecycle {
    email::domain::mailbox::lifecycle::InboxLifecycleService::new(
        PgMailboxSync::new(db),
        crate::outbound::inbox_lifecycle::InboxLifecycleClients {
            imap,
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
    imap: crate::outbound::email_api::imap::ImapMailboxGateway,
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
            imap,
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
