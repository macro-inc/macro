//! A Gmail inbox over `gmail_emulator`, synced by the inbox sync workers.

use super::queues::{QueueSpec, Queued, Queues};
use crate::pubsub::inbox_sync::worker::InboxSyncContext;
use crate::pubsub::test_support::{self, GmailEndpoints, InboxSyncWiring, fake_sqs};
use gmail_emulator::{Fault, FaultError, GmailEmulator, NewMessage, Route, Seed, SeedMailbox};
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use models_email::gmail::inbox_sync::{
    GmailMessagePayload, InboxSyncOperation, InboxSyncPubsubMessage,
};
use sqlx::PgPool;
use tokio_util::task::TaskTracker;
use uuid::Uuid;

#[cfg(test)]
mod specs;

const OWNER: &str = "owner@example.com";

/// The inbox sync queues' redrive policies (`infra/stacks/email-service`).
const SYNC_MAX_RECEIVES: u32 = 3;
const SYNC_RETRY_MAX_RECEIVES: u32 = 100;

/// More deliveries than any spec needs; a sync that doesn't settle by then
/// is looping.
const MAX_DELIVERIES: usize = 500;

/// Mail arriving in the Gmail mailbox.
pub struct Mail(NewMessage);

impl Mail {
    pub fn from(sender: &str) -> Mail {
        Mail(NewMessage {
            from: Some(sender.to_string()),
            subject: Some("Hello".to_string()),
            text: Some("Hi there.".to_string()),
            ..NewMessage::default()
        })
    }

    /// A whole RFC 822 message, for encodings the other fields can't spell.
    pub fn raw(rfc822: &str) -> Mail {
        Mail(NewMessage {
            raw: Some(rfc822.to_string()),
            ..NewMessage::default()
        })
    }
}

/// A message Gmail holds.
#[derive(Clone, Debug)]
pub struct Received {
    pub id: String,
}

/// A message Macro stored.
#[derive(Clone, Debug, sqlx::FromRow)]
pub struct Stored {
    pub provider_id: String,
    pub body_text: Option<String>,
}

pub struct GmailInbox {
    pub db: PgPool,
    pub link_id: Uuid,
    gmail: GmailEmulator,
    queues: Queues,
    sync_queue: String,
    sync: InboxSyncContext,
    sync_retry: InboxSyncContext,
    lifecycle: crate::composition::InboxLifecycle,
}

impl GmailInbox {
    /// An inbox whose connect has finished: its link, and the sync cursor
    /// at the mailbox's current history.
    pub async fn connected(db: PgPool) -> GmailInbox {
        GmailInbox::connected_to(db, SeedMailbox::new(OWNER)).await
    }

    /// A connected inbox whose owner left Gmail access unticked on Google's
    /// consent screen: the grant yields tokens, but not for Gmail.
    pub async fn connected_without_gmail_access(db: PgPool) -> GmailInbox {
        let mut mailbox = SeedMailbox::new(OWNER);
        mailbox.scopes = Some(vec![
            "openid".to_string(),
            "https://www.googleapis.com/auth/userinfo.email".to_string(),
            "https://www.googleapis.com/auth/userinfo.profile".to_string(),
        ]);
        GmailInbox::connected_to(db, mailbox).await
    }

    async fn connected_to(db: PgPool, mailbox: SeedMailbox) -> GmailInbox {
        let gmail = GmailEmulator::start(Seed {
            mailboxes: vec![mailbox],
            ..Seed::default()
        })
        .await
        .expect("Gmail emulator");
        let services_url = super::services::start().await;
        let sqs = fake_sqs::FakeSqs::start().await;
        let sqs_sdk = fake_sqs::client(&sqs.url, false);
        let sync_queue = sqs.queue_url("gmail-webhook");
        let retry_queue = sqs.queue_url("gmail-webhook-retry");
        let sqs_client = sqs_client::SQS::new(sqs_sdk.clone())
            .gmail_inbox_sync_queue(&sync_queue)
            .gmail_inbox_sync_retry_queue(&retry_queue)
            .gmail_ops_queue(&sqs.queue_url("gmail-ops"))
            .gmail_ops_retry_queue(&sqs.queue_url("gmail-ops-retry"))
            .email_backfill_queue(&sqs.queue_url("backfill"))
            .email_link_manager_queue(&sqs.queue_url("link-manager"))
            .sfs_uploader_queue(&sqs.queue_url("sfs"));
        let redis = redis::Client::open(test_support::redis_url()).expect("redis url");
        let email_api = test_support::gmail_api(
            db.clone(),
            &redis,
            GmailEndpoints {
                gmail: &gmail.gmail_url(),
                people: &gmail.people_url(),
                certs: &gmail.certs_url(),
                auth: &gmail.authentication_service_url(),
            },
            sqs_client.clone(),
        )
        .await;
        let broker = MacroEventBrokerService::new(
            KafkaEventPublisher::new("127.0.0.1:9092").expect("kafka publisher"),
            TaskTracker::new(),
        );
        let wiring = InboxSyncWiring {
            db: &db,
            sqs_sdk: &sqs_sdk,
            sqs_client: &sqs_client,
            email_api: &email_api,
            redis: &redis,
            broker: &broker,
            services_url: &services_url,
        };
        let sync = wiring.context(false, &sync_queue);
        let sync_retry = wiring.context(true, &retry_queue);
        let lifecycle = crate::composition::inbox_lifecycle(
            email_api_client::OutlookApiClientRepository::new().expect("outlook client"),
            db.clone(),
            authentication_service_client::AuthServiceClient::new(
                "secret".to_string(),
                services_url.clone(),
            ),
            sqs_client,
            connection_gateway_client::client::ConnectionGatewayClient::new(
                "key".to_string(),
                services_url,
            ),
        );
        let queues = Queues::new(
            sqs,
            vec![
                QueueSpec {
                    url: sync_queue.clone(),
                    max_receives: SYNC_MAX_RECEIVES,
                },
                QueueSpec {
                    url: retry_queue,
                    max_receives: SYNC_RETRY_MAX_RECEIVES,
                },
            ],
        );

        let inbox = GmailInbox {
            db,
            link_id: Uuid::now_v7(),
            gmail,
            queues,
            sync_queue,
            sync,
            sync_retry,
            lifecycle,
        };
        inbox.link().await;
        inbox
    }

    async fn link(&self) {
        sqlx::query(
            "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'GMAIL', true, NOW(), NOW())",
        )
        .bind(self.link_id)
        .bind(format!("macro|{OWNER}"))
        .bind(format!("fa-{}", self.link_id))
        .bind(OWNER)
        .execute(&self.db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO email_gmail_histories (link_id, history_id) VALUES ($1, $2)")
            .bind(self.link_id)
            .bind(self.history_id().to_string())
            .execute(&self.db)
            .await
            .unwrap();
    }

    /// Mail arrives in the Gmail mailbox.
    pub fn receives(&self, mail: Mail) -> Received {
        let delivered = self.gmail.deliver(OWNER, &mail.0).expect("delivery");
        Received { id: delivered.id }
    }

    /// Gmail answers the next `times` calls to `route` with `error`.
    pub fn gmail_fails(&self, route: Route, error: FaultError, times: u32) {
        self.gmail.inject_fault(Fault {
            mailbox: Some(OWNER.to_string()),
            route: Some(route),
            error: Some(error),
            retry_after_seconds: None,
            delay_ms: None,
            times: Some(times),
        });
    }

    /// The inbox has a link but no sync cursor yet, as before its first
    /// backfill stores one.
    pub async fn has_no_sync_cursor_yet(&self) {
        sqlx::query("DELETE FROM email_gmail_histories WHERE link_id = $1")
            .bind(self.link_id)
            .execute(&self.db)
            .await
            .unwrap();
    }

    /// Gmail tells Macro the mailbox changed, and the workers run until
    /// nothing is left to deliver.
    pub async fn syncs(&mut self) {
        self.queue_notification().await;
        self.drain().await;
    }

    /// What Macro shows for `received`, if it stored it.
    pub async fn shows(&self, received: &Received) -> Option<Stored> {
        self.messages()
            .await
            .into_iter()
            .find(|message| message.provider_id == received.id)
    }

    /// Every message Macro stored for the inbox.
    pub async fn messages(&self) -> Vec<Stored> {
        sqlx::query_as(
            "SELECT provider_id, body_text FROM email_messages
             WHERE link_id = $1 ORDER BY internal_date_ts, provider_id",
        )
        .bind(self.link_id)
        .fetch_all(&self.db)
        .await
        .unwrap()
    }

    /// Whether Macro asks the owner to reconnect the inbox.
    pub async fn asks_owner_to_reconnect(&self) -> bool {
        sqlx::query_scalar("SELECT needs_reauth FROM email_links WHERE id = $1")
            .bind(self.link_id)
            .fetch_one(&self.db)
            .await
            .unwrap()
    }

    /// Work SQS gave up on.
    pub fn dead_letters(&self) -> &[Queued] {
        &self.queues.dead_letters
    }

    fn history_id(&self) -> u64 {
        self.gmail
            .mailboxes()
            .into_iter()
            .find(|mailbox| mailbox.email == OWNER)
            .expect("the owner's mailbox")
            .history_id
    }

    /// What the Gmail webhook queues for a push of the mailbox's current
    /// history id.
    fn notification(&self) -> InboxSyncPubsubMessage {
        InboxSyncPubsubMessage {
            link_id: self.link_id,
            operation: InboxSyncOperation::GmailMessage(GmailMessagePayload {
                history_id: self.history_id(),
            }),
        }
    }

    async fn queue_notification(&self) {
        let sqs_client = sqs_client::SQS::new(fake_sqs::client(&self.queues.sqs_url(), false))
            .gmail_inbox_sync_queue(&self.sync_queue);
        sqs_client
            .enqueue_gmail_inbox_sync_notification(self.notification())
            .await
            .unwrap();
    }

    /// Publishes the outbox and delivers every queued message until a worker
    /// deletes it or its queue dead-letters it.
    async fn drain(&mut self) {
        for _ in 0..MAX_DELIVERIES {
            while self.lifecycle.publish_once().await.expect("outbox publish") {}
            self.queues.absorb();
            let Some((queued, message)) = self.queues.receive() else {
                return;
            };
            let ctx = if queued.queue_url == self.sync_queue {
                self.sync.clone()
            } else {
                self.sync_retry.clone()
            };
            crate::pubsub::inbox_sync::process::process_message(ctx, &message)
                .await
                .ok();
            self.queues.settle(queued);
        }
        panic!("inbox sync did not settle");
    }
}
