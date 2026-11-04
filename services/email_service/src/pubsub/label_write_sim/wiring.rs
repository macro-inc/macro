//! The production Gmail client and request gate wired to the fake Gmail, and
//! direct access to the gate's Redis state, the pending label write markers
//! and queued label writes.

use crate::outbound::email_api::{
    EmailServiceTokenSource, GmailApi, RateBudget, RedisGmailRequestGate,
};
use email::domain::ports::EmailService;
use email_api_client::GmailApiClientRepository;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::gmail::gmail_ops::{GmailOpsOperation, GmailOpsPubsubMessage};
use sqlx::PgPool;
use uuid::Uuid;

pub fn redis_client(client: redis::Client) -> crate::util::redis::RedisClient {
    crate::util::redis::RedisClient::new(client, 60)
}

pub async fn gmail_api(
    db: PgPool,
    redis: &redis::Client,
    gmail_url: &str,
    services_url: &str,
    sqs_client: sqs_client::SQS,
) -> GmailApi {
    let client = gmail_client::GmailClient::new_with_urls(
        Some("projects/sim/topics/gmail".to_string()),
        gmail_url.to_string(),
        format!("{services_url}/people"),
        format!("{services_url}/certs"),
        "sim".to_string(),
    );
    GmailApi::new(
        GmailApiClientRepository::new(client),
        EmailServiceTokenSource::new(
            db,
            redis.get_multiplexed_async_connection().await.unwrap(),
            authentication_service_client::AuthServiceClient::new(
                "secret".to_string(),
                services_url.to_string(),
            ),
            sqs_client,
        ),
        RedisGmailRequestGate::new(
            redis.get_connection_manager().await.unwrap(),
            RateBudget::Live,
        ),
    )
}

fn gate_keys(link_id: Uuid) -> [String; 6] {
    let scope = format!("gmail:{{{link_id}}}");
    [
        format!("{scope}:inflight"),
        format!("{scope}:window"),
        format!("{scope}:cooldown"),
        format!("{scope}:waiting"),
        format!("{scope}:backfill_cooldown"),
        format!("{scope}:limit"),
    ]
}

/// Clears the request gate's state, including the concurrency limit it learns
/// from a Gmail 429, so each simulated step starts admitted regardless of
/// wall-clock time.
pub async fn reset_admission(redis: &mut redis::aio::MultiplexedConnection, link_id: Uuid) {
    let _: () = redis::cmd("DEL")
        .arg(&gate_keys(link_id))
        .query_async(redis)
        .await
        .unwrap();
}

/// Makes the real gate refuse the next request locally, as after a Gmail 429
/// on another worker.
pub async fn refuse_admission(redis: &mut redis::aio::MultiplexedConnection, link_id: Uuid) {
    let [_, _, cooldown, ..] = gate_keys(link_id);
    let _: () = redis::cmd("SET")
        .arg(cooldown)
        .arg("1")
        .arg("PX")
        .arg(5_000)
        .query_async(redis)
        .await
        .unwrap();
}

pub async fn clear_markers(db: &PgPool, message_ids: &[Uuid]) {
    sqlx::query("DELETE FROM email_gmail_pending_label_writes WHERE message_id = ANY($1)")
        .bind(message_ids)
        .execute(db)
        .await
        .unwrap();
}

#[derive(Clone, Debug)]
pub struct Marker {
    pub message_id: Uuid,
    pub label: String,
    pub write_id: Uuid,
    pub live: bool,
}

pub async fn markers(db: &PgPool, message_ids: &[Uuid]) -> Vec<Marker> {
    let rows: Vec<(Uuid, String, Uuid, bool)> = sqlx::query_as(
        "SELECT message_id, provider_label_id, write_id, expires_at > now()
         FROM email_gmail_pending_label_writes WHERE message_id = ANY($1)
         ORDER BY message_id, provider_label_id",
    )
    .bind(message_ids)
    .fetch_all(db)
    .await
    .unwrap();
    rows.into_iter()
        .map(|(message_id, label, write_id, live)| Marker {
            message_id,
            label,
            write_id,
            live,
        })
        .collect()
}

/// Moves every marker 12 hours closer to its expiry.
pub async fn age_markers(db: &PgPool, message_ids: &[Uuid]) {
    sqlx::query(
        "UPDATE email_gmail_pending_label_writes
         SET expires_at = expires_at - interval '12 hours'
         WHERE message_id = ANY($1)",
    )
    .bind(message_ids)
    .execute(db)
    .await
    .unwrap();
}

/// A queued label write, decoded from its SQS body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LabelOp {
    /// (database id, provider id) of each message the op sends.
    pub messages: Vec<(Uuid, String)>,
    pub add: Vec<String>,
    pub remove: Vec<String>,
    pub write_id: Option<Uuid>,
}

pub fn decode_label_op(body: &str) -> Option<LabelOp> {
    let message: GmailOpsPubsubMessage = serde_json::from_str(body).ok()?;
    match message.operation {
        GmailOpsOperation::ModifyMessageLabels(payload) => Some(LabelOp {
            messages: vec![(payload.db_message_id, payload.provider_message_id)],
            add: payload.labels_to_add,
            remove: payload.labels_to_remove,
            write_id: payload.pending_write_id,
        }),
        GmailOpsOperation::ModifyMessageLabelsBatch(payload) => Some(LabelOp {
            messages: payload
                .messages
                .into_iter()
                .map(|message| (message.db_message_id, message.provider_message_id))
                .collect(),
            add: payload.labels_to_add,
            remove: payload.labels_to_remove,
            write_id: payload.pending_write_id,
        }),
        _ => None,
    }
}

/// Bulk archive through the bulk route's service call. Returns the threads
/// the service reported as not changed.
pub async fn archive_many<S: EmailService>(
    service: &S,
    owner: MacroUserIdStr<'static>,
    threads: Vec<Uuid>,
    archived: bool,
) -> Result<Vec<Uuid>, String> {
    service
        .set_threads_archived(owner, threads, archived)
        .await
        .map(|result| result.failed_thread_ids)
        .map_err(|error| format!("{error:?}"))
}
