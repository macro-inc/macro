//! One Gmail mailbox wired to the production worker and domain code.
//!
//! Real: Postgres (migrated schema), Redis (request gate or limiter, token
//! cache), the `GmailApi` service with its `GmailClient`, the gmail_ops and
//! inbox_sync `process_message` entry points, and the `EmailServiceImpl` the
//! HTTP routes use for archive, read, star, label and trash actions.
//! Faked: Gmail's HTTP API, SQS's HTTP API, and catch-all 200 responses for
//! the auth service, SFS, DSS and connection gateway.

use super::fake_gmail::{FakeGmail, GmailMessage, GmailState};
use super::fake_sqs::{self, FakeSqs};
use super::wiring;
use crate::pubsub::context::{CrmMetadataResolver, PubSubContext};
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use axum::Router;
use axum::response::IntoResponse;
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::cache::TokenCacheKey;
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use tokio_util::task::TaskTracker;
use uuid::Uuid;

pub const INBOX: &str = "INBOX";
pub const UNREAD: &str = "UNREAD";
pub const STARRED: &str = "STARRED";
pub const TRASH: &str = "TRASH";
pub const WORK: &str = "Label_work";

pub const THREADS: [&str; 3] = ["t1", "t2", "t3"];
/// Provider message ids, their thread, and their starting labels.
pub const MESSAGES: [(&str, &str, &[&str]); 6] = [
    ("m1a", "t1", &[INBOX, UNREAD]),
    ("m1b", "t1", &[INBOX, STARRED]),
    ("m1c", "t1", &[INBOX]),
    ("m2a", "t2", &[INBOX, UNREAD]),
    ("m2b", "t2", &[INBOX]),
    ("m3a", "t3", &[INBOX, UNREAD, WORK]),
];
/// Labels the simulation tracks per message.
pub const TRACKED: [&str; 5] = [INBOX, UNREAD, STARRED, TRASH, WORK];
const LABELS: [(&str, &str, &str); 7] = [
    ("INBOX", "INBOX", "system"),
    ("UNREAD", "UNREAD", "system"),
    ("STARRED", "STARRED", "system"),
    ("TRASH", "TRASH", "system"),
    ("SPAM", "SPAM", "system"),
    ("SENT", "SENT", "system"),
    ("Label_work", "Work", "user"),
];

pub type EmailSvc = EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    sqs_client::SQS,
    crm::domain::service::CrmServiceImpl<
        crm::outbound::companies_repo::CompaniesRepositoryImpl,
        crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
    >,
    entity_access_management::domain::service::EntityAccessManagementServiceImpl<
        entity_access_management::outbound::PgRepository,
    >,
    MacroEventBrokerService<KafkaEventPublisher, TaskTracker>,
>;

pub struct Queues {
    pub ops: String,
    pub ops_retry: String,
    pub sync: String,
    pub sync_retry: String,
}

pub struct World {
    pub db: PgPool,
    pub gmail: FakeGmail,
    pub sqs: FakeSqs,
    pub redis: redis::aio::MultiplexedConnection,
    pub link_id: Uuid,
    pub queues: Queues,
    pub ops: GmailOpsContext,
    pub ops_retry: GmailOpsContext,
    pub sync: PubSubContext,
    pub sync_retry: PubSubContext,
    pub email: EmailSvc,
    /// Provider message id → database id.
    pub message_ids: BTreeMap<String, Uuid>,
    /// Provider thread id → database id.
    pub thread_ids: BTreeMap<String, Uuid>,
    pub label_ids: BTreeMap<String, Uuid>,
    /// Whether producers send label writes as batches or, as they do by
    /// default, one single-message operation per changed message.
    pub label_write_batches: bool,
}

/// Runs `test` on a runtime of its own, connected to `pool`'s database, with
/// two worker threads of `worker_stack` bytes of stack each, as the email
/// workers have. Tasks `test` spawns run on those threads.
pub fn on_worker_stacks<F, Fut>(pool: &PgPool, worker_stack: usize, test: F)
where
    F: FnOnce(PgPool) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()>,
{
    let options = pool.connect_options().as_ref().clone();
    let outcome = std::thread::spawn(move || {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_stack_size(worker_stack)
            .enable_all()
            .build()
            .expect("test runtime")
            .block_on(async move {
                let pool = sqlx::postgres::PgPoolOptions::new()
                    .connect_with(options)
                    .await
                    .expect("test database");
                test(pool).await;
            });
    })
    .join();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

pub fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("sim@example.com").unwrap()
}

pub fn link_uuid(shard: u32) -> Uuid {
    Uuid::from_u128(0x5100_0000_0000_0000_0000_0000_0000_0000 + u128::from(shard))
}

fn thread_uuid(shard: u32, index: usize) -> Uuid {
    Uuid::from_u128(
        0x5200_0000_0000_0000_0000_0000_0000_0000 + (u128::from(shard) << 16) + index as u128,
    )
}

fn message_uuid(shard: u32, index: usize) -> Uuid {
    Uuid::from_u128(
        0x5300_0000_0000_0000_0000_0000_0000_0000 + (u128::from(shard) << 16) + index as u128,
    )
}

fn label_uuid(shard: u32, index: usize) -> Uuid {
    Uuid::from_u128(
        0x5400_0000_0000_0000_0000_0000_0000_0000 + (u128::from(shard) << 16) + index as u128,
    )
}

pub fn initial_gmail() -> GmailState {
    let mut state = GmailState::default();
    state.history_id = 100;
    state.labels = LABELS
        .iter()
        .map(|(id, name, kind)| (id.to_string(), name.to_string(), kind.to_string()))
        .collect();
    for (index, (id, thread, labels)) in MESSAGES.iter().enumerate() {
        state.messages.insert(
            id.to_string(),
            GmailMessage {
                thread_id: thread.to_string(),
                labels: labels.iter().map(|label| label.to_string()).collect(),
                internal_date_ms: 1_790_000_000_000 + index as i64 * 60_000,
            },
        );
    }
    state
}

impl World {
    pub async fn new(db: PgPool, shard: u32, label_write_batches: bool) -> World {
        let gmail = FakeGmail::start(initial_gmail()).await;
        let sqs = FakeSqs::start().await;
        let services_url = start_catch_all().await;
        let link_id = link_uuid(shard);
        let queues = Queues {
            ops: sqs.queue_url("gmail-ops"),
            ops_retry: sqs.queue_url("gmail-ops-retry"),
            sync: sqs.queue_url("gmail-webhook"),
            sync_retry: sqs.queue_url("gmail-webhook-retry"),
        };
        let mut world = World::compose(
            db,
            gmail,
            sqs.clone(),
            fake_sqs::client(&sqs.url, false),
            &services_url,
            link_id,
            queues,
            label_write_batches,
        )
        .await;
        world.seed(shard).await;
        world
    }

    /// Wires the production contexts to `gmail` and an SQS endpoint.
    async fn compose(
        db: PgPool,
        gmail: FakeGmail,
        sqs: FakeSqs,
        sqs_sdk: aws_sdk_sqs::Client,
        services_url: &str,
        link_id: Uuid,
        queues: Queues,
        label_write_batches: bool,
    ) -> World {
        let redis_url =
            std::env::var("REDIS_URI").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        let redis_client = redis::Client::open(redis_url).expect("redis url");
        let redis = redis_client
            .get_multiplexed_async_connection()
            .await
            .expect("redis connection");
        let sqs_client = sqs_client::SQS::new(sqs_sdk.clone())
            .gmail_inbox_sync_queue(&queues.sync)
            .gmail_inbox_sync_retry_queue(&queues.sync_retry)
            .gmail_ops_queue(&queues.ops)
            .gmail_ops_retry_queue(&queues.ops_retry)
            .gmail_label_write_batches(label_write_batches)
            .email_backfill_queue(&format!("{services_url}/queue/backfill"))
            .email_link_manager_queue(&format!("{services_url}/queue/link-manager"))
            .sfs_uploader_queue(&format!("{services_url}/queue/sfs"));
        let email_api = wiring::gmail_api(
            db.clone(),
            &redis_client,
            &gmail.url,
            services_url,
            sqs_client.clone(),
        )
        .await;
        let worker =
            |queue: &str| sqs_worker::SQSWorker::new(sqs_sdk.clone(), queue.to_string(), 1, 1);
        let ops_context = |retry_worker: bool, queue: &str| GmailOpsContext {
            db: db.clone(),
            sqs_worker: worker(queue),
            sqs_client: sqs_client.clone(),
            email_api: email_api.clone(),
            retry_worker,
        };
        let broker = MacroEventBrokerService::new(
            KafkaEventPublisher::new("127.0.0.1:9092").expect("kafka publisher"),
            TaskTracker::new(),
        );
        let crm_service = crm::domain::service::CrmServiceImpl::new(
            crm::outbound::companies_repo::CompaniesRepositoryImpl::new(db.clone()),
            CrmMetadataResolver::Unfurl(
                crm::outbound::unfurl_resolver::UnfurlCompanyMetadataResolver::new(Arc::new(
                    unfurl::domain::service::UnfurlServiceImpl::new(
                        unfurl::outbound::ReqwestUnfurlFetcher::new().expect("unfurl fetcher"),
                    ),
                )),
            ),
        );
        let sync_context = |retry_worker: bool, queue: &str| PubSubContext {
            gmail_history: email::domain::mailbox::gmail_history::GmailHistoryService(
                email::outbound::mailbox_pg::PgMailboxSync::new(db.clone()),
            ),
            invitation_extractor: crate::pubsub::invitation_extraction::compose(
                db.clone(),
                email_api.clone(),
            ),
            db: db.clone(),
            sqs_worker: worker(queue),
            sqs_client: sqs_client.clone(),
            contacts_ingress: Arc::new(contacts::domain::service::SqsContactsIngress {
                queue: contacts::outbound::ingress::SqsContactsQueue::new(
                    sqs_sdk.clone(),
                    format!("{services_url}/queue/contacts"),
                ),
            }),
            email_api: email_api.clone(),
            redis_client: wiring::redis_client(redis_client.clone()),
            notification_ingress_service: Arc::new(
                notification::domain::service::SqsNotificationIngress {
                    queue: notification::outbound::queue::SqsQueue::new(
                        sqs_sdk.clone(),
                        format!("{services_url}/queue/notifications"),
                    ),
                },
            ),
            sfs_client: static_file_service_client::StaticFileServiceClient::new(
                "key".to_string(),
                services_url.to_string(),
            ),
            connection_gateway_client:
                connection_gateway_client::client::ConnectionGatewayClient::new(
                    "key".to_string(),
                    services_url.to_string(),
                ),
            dss_client: document_storage_service_client::DocumentStorageServiceClient::new(
                "key".to_string(),
                services_url.to_string(),
            ),
            system_properties_service: Arc::new(
                system_properties::SystemPropertiesServiceImpl::new(
                    system_properties::PgSystemPropertiesRepository::new(db.clone()),
                ),
            ),
            crm_service: crm_service.clone(),
            macro_event_broker: broker.clone(),
            notifications_enabled: false,
            retry_worker,
        };
        let email = EmailServiceImpl::new(
            EmailPgRepo::new(db.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db.clone())),
            sqs_client.clone(),
            crm::domain::service::CrmServiceImpl::new(
                crm::outbound::companies_repo::CompaniesRepositoryImpl::new(db.clone()),
                crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
            ),
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(db.clone()),
            ),
            0,
        )
        .with_macro_event_broker(broker.clone());

        World {
            ops: ops_context(false, &queues.ops),
            ops_retry: ops_context(true, &queues.ops_retry),
            sync: sync_context(false, &queues.sync),
            sync_retry: sync_context(true, &queues.sync_retry),
            db,
            gmail,
            sqs,
            redis,
            link_id,
            queues,
            email,
            message_ids: BTreeMap::new(),
            thread_ids: BTreeMap::new(),
            label_ids: BTreeMap::new(),
            label_write_batches,
        }
    }

    async fn seed(&mut self, shard: u32) {
        let link = self.link_id;
        sqlx::query(
            "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
             VALUES ($1, 'macro|sim@example.com', $2, $3, 'GMAIL', true, NOW(), NOW())",
        )
        .bind(link)
        .bind(format!("sim-user-{shard}"))
        .bind(format!("sim{shard}@example.com"))
        .execute(&self.db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO email_gmail_histories (link_id, history_id) VALUES ($1, '100')")
            .bind(link)
            .execute(&self.db)
            .await
            .unwrap();
        for (index, (id, name, kind)) in LABELS.iter().enumerate() {
            let label_id = label_uuid(shard, index);
            let label_type = if *kind == "system" { "System" } else { "User" };
            sqlx::query(&format!(
                "INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
                 VALUES ($1, $2, $3, $4, 'Show', 'LabelShow', '{label_type}', NOW())"
            ))
            .bind(label_id)
            .bind(link)
            .bind(id)
            .bind(name)
            .execute(&self.db)
            .await
            .unwrap();
            self.label_ids.insert(id.to_string(), label_id);
        }
        for (index, thread) in THREADS.iter().enumerate() {
            let thread_id = thread_uuid(shard, index);
            sqlx::query(
                "INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
                 VALUES ($1, $2, $3, true, false, NOW(), NOW())",
            )
            .bind(thread_id)
            .bind(thread)
            .bind(link)
            .execute(&self.db)
            .await
            .unwrap();
            self.thread_ids.insert(thread.to_string(), thread_id);
        }
        for (index, (id, thread, labels)) in MESSAGES.iter().enumerate() {
            let message_id = message_uuid(shard, index);
            sqlx::query(
                "INSERT INTO email_messages (id, thread_id, link_id, provider_id, provider_thread_id, is_read, is_starred, is_sent, is_draft, has_attachments, internal_date_ts, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, false, to_timestamp($8::double precision / 1000), NOW(), NOW())",
            )
            .bind(message_id)
            .bind(self.thread_ids[*thread])
            .bind(link)
            .bind(id)
            .bind(thread)
            .bind(!labels.contains(&UNREAD))
            .bind(labels.contains(&STARRED))
            .bind((1_790_000_000_000 + index as i64 * 60_000) as f64)
            .execute(&self.db)
            .await
            .unwrap();
            self.message_ids.insert(id.to_string(), message_id);
        }
        self.reset().await;
    }

    /// Puts the mailbox, Gmail, queues and admission state back to the start.
    pub async fn reset(&mut self) {
        let message_ids: Vec<Uuid> = self.message_ids.values().copied().collect();
        sqlx::query("DELETE FROM email_message_labels WHERE message_id = ANY($1)")
            .bind(&message_ids)
            .execute(&self.db)
            .await
            .unwrap();
        wiring::clear_markers(&self.db, &message_ids).await;
        for (id, _, labels) in MESSAGES {
            let message_id = self.message_ids[id];
            for label in labels {
                sqlx::query(
                    "INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)",
                )
                .bind(message_id)
                .bind(self.label_ids[*label])
                .execute(&self.db)
                .await
                .unwrap();
            }
            sqlx::query("UPDATE email_messages SET is_read = $2, is_starred = $3 WHERE id = $1")
                .bind(message_id)
                .bind(!labels.contains(&UNREAD))
                .bind(labels.contains(&STARRED))
                .execute(&self.db)
                .await
                .unwrap();
        }
        for thread_id in self.thread_ids.values() {
            let mut connection = self.db.acquire().await.unwrap();
            email_db_client::threads::update::update_thread_metadata(
                &mut connection,
                *thread_id,
                self.link_id,
            )
            .await
            .unwrap();
        }
        sqlx::query("UPDATE email_gmail_histories SET history_id = '100' WHERE link_id = $1")
            .bind(self.link_id)
            .execute(&self.db)
            .await
            .unwrap();
        *self.gmail.lock() = initial_gmail();
        {
            let mut sqs = self.sqs.lock();
            sqs.sent.clear();
            sqs.acks.clear();
            sqs.failed_sends.clear();
            sqs.outage = false;
        }
        self.seed_token().await;
        wiring::reset_admission(&mut self.redis, self.link_id).await;
    }

    pub async fn seed_token(&mut self) {
        let link = email_db_client::links::get::fetch_link_by_id(&self.db, self.link_id)
            .await
            .unwrap()
            .unwrap();
        let key = TokenCacheKey::new(
            &link.fusionauth_user_id,
            link.email_address.0.as_ref(),
            link.provider.as_str(),
        )
        .to_redis_key();
        let _: () = redis::cmd("SET")
            .arg(key)
            .arg("fake-access-token")
            .arg("EX")
            .arg(86_400)
            .query_async(&mut self.redis)
            .await
            .unwrap();
    }

    /// Labels per provider message id in the database.
    pub async fn db_labels(&self) -> BTreeMap<String, BTreeSet<String>> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT m.provider_id, l.provider_label_id
             FROM email_messages m
             JOIN email_message_labels ml ON ml.message_id = m.id
             JOIN email_labels l ON l.id = ml.label_id
             WHERE m.link_id = $1",
        )
        .bind(self.link_id)
        .fetch_all(&self.db)
        .await
        .unwrap();
        let mut labels: BTreeMap<String, BTreeSet<String>> = MESSAGES
            .iter()
            .map(|(id, _, _)| (id.to_string(), BTreeSet::new()))
            .collect();
        for (message, label) in rows {
            labels.entry(message).or_default().insert(label);
        }
        labels
    }

    pub fn gmail_labels(&self) -> BTreeMap<String, BTreeSet<String>> {
        self.gmail
            .lock()
            .messages
            .iter()
            .map(|(id, message)| (id.clone(), message.labels.clone()))
            .collect()
    }

    /// Threads and messages whose stored flags disagree with their labels.
    pub async fn flag_mismatches(&self) -> Vec<String> {
        let mut problems = Vec::new();
        let messages: Vec<(String, bool, bool, bool, bool)> = sqlx::query_as(
            "SELECT m.provider_id, m.is_read, m.is_starred,
                EXISTS (SELECT 1 FROM email_message_labels ml JOIN email_labels l ON l.id = ml.label_id
                        WHERE ml.message_id = m.id AND l.provider_label_id = 'UNREAD'),
                EXISTS (SELECT 1 FROM email_message_labels ml JOIN email_labels l ON l.id = ml.label_id
                        WHERE ml.message_id = m.id AND l.provider_label_id = 'STARRED')
             FROM email_messages m WHERE m.link_id = $1",
        )
        .bind(self.link_id)
        .fetch_all(&self.db)
        .await
        .unwrap();
        for (id, is_read, is_starred, unread, starred) in messages {
            if is_read == unread {
                problems.push(format!(
                    "message {id}: is_read={is_read} but UNREAD={unread}"
                ));
            }
            if is_starred != starred {
                problems.push(format!(
                    "message {id}: is_starred={is_starred} but STARRED={starred}"
                ));
            }
        }
        let threads: Vec<(String, bool, bool, bool, bool)> = sqlx::query_as(
            "SELECT t.provider_id, t.inbox_visible, t.is_read,
                COALESCE(bool_or((f.in_inbox AND NOT f.in_sent)), false),
                COALESCE(bool_and(m.is_read), true)
             FROM email_threads t
             JOIN email_messages m ON m.thread_id = t.id
             JOIN email_message_mailbox_facts f ON f.id = m.id
             WHERE t.link_id = $1 AND f.is_present
             GROUP BY t.id",
        )
        .bind(self.link_id)
        .fetch_all(&self.db)
        .await
        .unwrap();
        for (id, inbox_visible, is_read, expected_visible, expected_read) in threads {
            if inbox_visible != expected_visible {
                problems.push(format!(
                    "thread {id}: inbox_visible={inbox_visible}, messages say {expected_visible}"
                ));
            }
            if is_read != expected_read {
                problems.push(format!(
                    "thread {id}: is_read={is_read}, messages say {expected_read}"
                ));
            }
        }
        problems
    }

    pub async fn thread_inbox_visible(&self, thread: &str) -> bool {
        sqlx::query_scalar("SELECT inbox_visible FROM email_threads WHERE id = $1")
            .bind(self.thread_ids[thread])
            .fetch_one(&self.db)
            .await
            .unwrap()
    }
}

/// Answers 200 `{}` to everything: auth, SFS, DSS, connection gateway, and
/// the SQS queues the simulation does not model.
async fn start_catch_all() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new().fallback(|| async {
        (
            axum::http::StatusCode::OK,
            [("content-type", "application/json")],
            "{}",
        )
            .into_response()
    });
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}
