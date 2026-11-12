//! An Outlook inbox over `outlook_emulator`, synced by the mailbox sync
//! loops (`mailbox_sync_worker`).

use crate::outbound::email_api::{MicrosoftCredentialsClient, ProviderMailboxGateway};
use email::domain::mailbox::MailboxSyncService;
use email::domain::mailbox::credentials::MailboxCredentials;
use email::outbound::mailbox_pg::PgMailboxSync;
use email_api_client::OutlookApiClientRepository;
use email_api_client::domain::ports::AlwaysAllowRateLimiter;
use email_api_client::domain::service::mailbox::MailboxApiService;
use macro_service_urls::MicrosoftGraphUrl;
use outlook_emulator::{Fault, FaultError, NewMessage, OutlookEmulator, Route, Seed};
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod specs;

const OWNER: &str = "owner@example.com";

/// More passes than any spec needs; a sync that doesn't settle by then is
/// looping.
const MAX_PASSES: usize = 200;

type OutlookSync = MailboxSyncService<
    PgMailboxSync,
    ProviderMailboxGateway<
        OutlookApiClientRepository,
        MailboxCredentials<PgMailboxSync, MicrosoftCredentialsClient>,
        AlwaysAllowRateLimiter,
    >,
    PgMailboxSync,
>;

/// A message Outlook holds.
#[derive(Clone, Debug)]
pub struct Received {
    pub id: String,
}

pub struct OutlookInbox {
    pub db: PgPool,
    pub link_id: Uuid,
    outlook: OutlookEmulator,
    sync: OutlookSync,
}

impl OutlookInbox {
    /// An inbox whose connect has finished: its link and the folder catalog
    /// stream that starts its sync.
    pub async fn connected(db: PgPool) -> OutlookInbox {
        let outlook = OutlookEmulator::start(Seed::with_mailboxes([OWNER]))
            .await
            .expect("Outlook emulator");
        let link_id = Uuid::now_v7();
        outlook
            .link_mailbox(&link_id.to_string(), OWNER)
            .expect("link the mailbox");
        let repository = PgMailboxSync::new(db.clone());
        let api = MailboxApiService::new(
            OutlookApiClientRepository::for_graph_url(&MicrosoftGraphUrl::from(
                outlook.graph_url(),
            ))
            .expect("outlook client"),
            MailboxCredentials::new(
                repository.clone(),
                MicrosoftCredentialsClient(authentication_service_client::AuthServiceClient::new(
                    "secret".to_string(),
                    outlook.authentication_service_url(),
                )),
            ),
            AlwaysAllowRateLimiter,
        );
        let sync =
            MailboxSyncService::new(repository.clone(), ProviderMailboxGateway(api), repository);

        let inbox = OutlookInbox {
            db,
            link_id,
            outlook,
            sync,
        };
        inbox.link().await;
        inbox
    }

    async fn link(&self) {
        sqlx::query(
            "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, grant_generation, is_sync_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'OUTLOOK', 1, true, NOW(), NOW())",
        )
        .bind(self.link_id)
        .bind(format!("macro|{OWNER}"))
        .bind(format!("fa-{}", self.link_id))
        .bind(OWNER)
        .execute(&self.db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO email_sync_streams (id, link_id, generation, kind, scope_id)
             VALUES ($1, $2, 1, 'folder_catalog', 'mail')",
        )
        .bind(Uuid::now_v7())
        .bind(self.link_id)
        .execute(&self.db)
        .await
        .unwrap();
    }

    /// Mail arrives in the Outlook inbox.
    pub fn receives(&self, sender: &str, subject: &str) -> Received {
        let delivered = self
            .outlook
            .deliver(
                OWNER,
                &NewMessage {
                    from: Some(sender.to_string()),
                    subject: Some(subject.to_string()),
                    text: Some("Hi there.".to_string()),
                    ..NewMessage::default()
                },
            )
            .expect("delivery");
        Received { id: delivered.id }
    }

    /// Graph answers the next `times` calls to `route` with `error`.
    pub fn graph_fails(&self, route: Route, error: FaultError, times: u32) {
        self.outlook.inject_fault(Fault {
            mailbox: Some(OWNER.to_string()),
            route: Some(route),
            error: Some(error),
            retry_after_seconds: None,
            delay_ms: None,
            times: Some(times),
        });
    }

    /// Graph drops the mailbox's delta tokens, as it does after a while.
    pub fn graph_forgets_the_sync_state(&self) {
        self.outlook
            .expire_delta_tokens(OWNER)
            .expect("expire delta tokens");
    }

    /// Runs the sync loops until none has work: marks the mailbox's streams
    /// due, as a change notification does, then discovers, enumerates and
    /// reconciles until every claim comes back empty.
    pub async fn syncs(&self) {
        self.run("UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1")
            .await;
        for _ in 0..MAX_PASSES {
            // A failed claim is rescheduled with backoff, as the worker loop
            // leaves it, so it counts as no work done in this pass.
            let discovered = self.sync.discover_once().await.unwrap_or(false);
            let enumerated = self.sync.enumerate_once().await.unwrap_or(false);
            let reconciled = self.sync.reconcile_once().await.unwrap_or(false);
            if !discovered && !enumerated && !reconciled {
                return;
            }
        }
        panic!("Outlook sync did not settle");
    }

    /// Time passes until every retry is due, and the loops run again.
    pub async fn syncs_after_backoff(&self) {
        self.run("UPDATE email_message_reconciliation SET available_at = now() WHERE link_id = $1")
            .await;
        self.syncs().await;
    }

    /// Whether Macro stored `received`.
    pub async fn shows(&self, received: &Received) -> bool {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM email_messages WHERE link_id = $1 AND provider_id = $2)",
        )
        .bind(self.link_id)
        .bind(&received.id)
        .fetch_one(&self.db)
        .await
        .unwrap()
    }

    async fn run(&self, statement: &str) {
        sqlx::query(statement)
            .bind(self.link_id)
            .execute(&self.db)
            .await
            .unwrap();
    }
}
