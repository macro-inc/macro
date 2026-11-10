//! Characterization of the unchanged backfill worker, including legacy messages.

use crate::parity::lab::worker::{Delivery, Queue, StepOutcome};
use crate::parity::lab::{Lab, LabOptions};
use crate::parity::suites::redis_database::RedisDatabase;
use crate::pubsub::label_write_sim::fake_gmail::HttpReply;
use models_email::service::attachment::{
    AttachmentUploadArgs, AttachmentUploadDestination, AttachmentUploadMetadata,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

macro_rules! cases {
    ($runner:ident; $( $name:ident, $shard:literal, $count:literal, $case:expr; )*) => {
        $(
            #[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
            async fn $name(pool: PgPool) {
                if !crate::parity::process_per_test() { return; }
                run_case(move || $runner(pool, stringify!($name), $shard, $count, $case)).await;
            }
        )*
    };
}

async fn run_case<F, Fut>(build: F)
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = ()>,
{
    tokio::task::spawn_blocking(move || {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("backfill scenario runtime")
            .block_on(build());
    })
    .await
    .expect("backfill scenario task");
}

mod attachments;
mod calendar;
mod completion;
mod crm;
mod envelope;
mod errors;
mod heartbeat;
mod initialization;
mod listing;
mod messages;
mod metadata;
mod people;
mod policies;
mod providers;
mod threads;

const JOB: Uuid = Uuid::from_u128(0x57000000000000000000000000004000);
const MISSING: Uuid = Uuid::from_u128(0x57000000000000000000000000004001);
const TEAM: Uuid = Uuid::from_u128(0x57000000000000000000000000004002);

async fn start(pool: PgPool, name: &'static str, shard: u32) -> Lab {
    let redis = RedisDatabase::start().await;
    start_in_redis(pool, name, shard, &redis).await
}

#[expect(clippy::disallowed_methods, reason = "Isolated backfill fixture SQL")]
async fn start_in_redis(
    pool: PgPool,
    name: &'static str,
    shard: u32,
    redis: &RedisDatabase,
) -> Lab {
    let mut lab = Lab::start_with_redis(
        pool,
        LabOptions {
            suite: "backfill_worker",
            name,
            shard,
            gmail_label_write_batches: true,
        },
        redis.uri.clone(),
    )
    .await;
    lab.record_redis_scope("");
    lab.transcript.normalizer.replace(&redis.uri, "<redis>");
    if let Some(user) = redis.fault_user() {
        lab.transcript
            .normalizer
            .replace(user, "<redis-fault-user>");
    }
    lab.transcript.normalizer.normalize_backfill_write_wait = true;
    lab.transcript.normalizer.normalize_backfill_retry_after = true;
    lab.transcript.normalizer.normalize_backfill_contacts_users = true;
    lab.transcript.normalizer.symbol(JOB, "<job>");
    lab.transcript.normalizer.symbol(MISSING, "<missing>");
    lab.transcript.normalizer.symbol(TEAM, "<team>");
    sqlx::query("UPDATE email_links SET email_address=lower(email_address)")
        .execute(&lab.db)
        .await
        .expect("lowercase links");
    for link in lab.fixture.links {
        lab.seed_link_token(link).await;
    }
    let at = chrono::DateTime::from_timestamp_millis(1_790_000_000_000).expect("provider time");
    for text in [
        at.to_rfc3339(),
        at.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true),
        format!("{at:?}"),
        format!("{at}"),
    ] {
        lab.transcript.normalizer.symbol(text, "<time:provider>");
    }
    lab.sqs.lock().fixed_date = Some("Mon, 01 Jan 2024 00:00:00 GMT".into());
    lab.stub.reply(
        "GET",
        "/internal/google_access_token",
        200,
        json!({"access_token":"fake-access-token"}),
    );
    lab.start_workers().await;
    seed_job(&lab, "InProgress", 100).await;
    progress(&lab, 100, 0).await;
    lab
}

#[expect(clippy::disallowed_methods, reason = "Isolated backfill job fixture")]
async fn seed_job(lab: &Lab, status: &str, total: i32) {
    sqlx::query("INSERT INTO email_backfill_jobs (id,link_id,fusionauth_user_id,status,total_threads,threads_retrieved_count,created_at,updated_at) VALUES($1,$2,$3,$4::email_backfill_job_status,$5,0,'2026-01-01','2026-01-01') ON CONFLICT(id) DO UPDATE SET status=excluded.status,total_threads=excluded.total_threads,threads_retrieved_count=0,init_lease_token=NULL,init_lease_expires_at=NULL,initialized_at=NULL,updated_at='2026-01-01'")
        .bind(JOB).bind(lab.fixture.links[0]).bind(&lab.fixture.fusion[0]).bind(status).bind(total)
        .execute(&lab.db).await.expect("job fixture");
}

async fn progress(lab: &Lab, total: i32, done: i32) {
    let _: () = redis::cmd("HSET")
        .arg(format!("bf_job_status:{JOB}"))
        .arg("total_threads")
        .arg(total)
        .arg("completed_threads")
        .arg(done)
        .query_async(&mut lab.redis_connection())
        .await
        .expect("job progress");
}
async fn message_progress(lab: &Lab, total: i32, done: i32) {
    let _: () = redis::cmd("HSET")
        .arg(format!("bf_thread_status:{JOB}:t1"))
        .arg("total_messages")
        .arg(total)
        .arg("completed_messages")
        .arg(done)
        .query_async(&mut lab.redis_connection())
        .await
        .expect("message progress");
}

fn delivery(lab: &Lab, name: &str, payload: Value, count: u32) -> Delivery {
    let mut fields = payload.as_object().expect("payload object").clone();
    if !name.ends_with("_for_user") {
        fields.insert("link_id".into(), json!(lab.fixture.links[0]));
    }
    if !name.contains("crm") {
        fields.insert("job_id".into(), json!(JOB));
    }
    let mut message = Delivery::new(json!({"backfillOperation":{name:fields}}).to_string());
    message.receive_count = count;
    message
}

async fn step(lab: &mut Lab, name: &str, message: &Delivery) -> StepOutcome {
    lab.worker_step(name, Queue::Backfill, message).await
}

fn list_payload(priority: bool) -> Value {
    json!({"next_page_token":null,"priority_pass":priority,"refresh_existing":false})
}
fn thread_payload(id: &str, refresh: bool) -> Value {
    json!({"thread_provider_id":id,"refresh_existing":refresh})
}
#[expect(clippy::disallowed_methods, reason = "Fixture thread identifier")]
async fn message_payload(lab: &Lab, id: &str) -> Value {
    let thread: Uuid =
        sqlx::query_scalar("SELECT id FROM email_threads WHERE link_id=$1 AND provider_id='t1'")
            .bind(lab.fixture.links[0])
            .fetch_one(&lab.db)
            .await
            .expect("fixture thread");
    json!({"thread_provider_id":"t1","thread_db_id":thread,"message_provider_id":id})
}
fn full_message(id: &str, thread: &str, labels: &[&str]) -> Value {
    json!({"id":id,"threadId":thread,"labelIds":labels,"snippet":"fixture preview",
      "internalDate":"1790000000000","sizeEstimate":20,"historyId":"200",
      "payload":{"mimeType":"text/plain","filename":"","partId":"",
      "headers":[{"name":"From","value":"Sender <sender@example.com>"},
      {"name":"To","value":"Recipient <recipient@example.com>"},
      {"name":"Subject","value":"Fixture subject"},
      {"name":"Message-ID","value":format!("<{id}@example.com>")},
      {"name":"Date","value":"Mon, 21 Sep 2026 14:13:20 +0000"}],
      "body":{"size":4,"data":"Ym9keQ"}}})
}
fn persistent(lab: &Lab, path: &str, status: u16, body: Value) {
    lab.gmail.lock().endpoint_replies.insert(
        format!("/gmail/v1/users/me/{path}"),
        [(status, body)].into(),
    );
}
fn catalog() -> Value {
    json!({"labels":(["INBOX","UNREAD","STARRED","TRASH","SPAM","SENT","Label_work"].into_iter().map(|id|json!({
        "id":id,"name":if id=="Label_work"{"Work"}else{id},"type":if id=="Label_work"{"user"}else{"system"},
        "messageListVisibility":"show","labelListVisibility":"labelShow"
    })).collect::<Vec<_>>())})
}
fn rejection(status: u16) -> Value {
    json!({"error":{"code":status,"message":"scripted provider rejection"}})
}

#[expect(
    clippy::disallowed_methods,
    reason = "Faults are scoped to a disposable fixture database"
)]
async fn trigger(lab: &Lab, table: &str, operation: &str, commit: bool, code: &str) {
    sqlx::query(&format!("CREATE FUNCTION parity_backfill_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity injected backfill failure' USING ERRCODE='{code}'; END $$"))
        .execute(&lab.db).await.expect("fault function");
    let statement = if commit {
        format!(
            "CREATE CONSTRAINT TRIGGER parity_backfill_fault AFTER {operation} ON {table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION parity_backfill_fault()"
        )
    } else {
        format!(
            "CREATE TRIGGER parity_backfill_fault BEFORE {operation} ON {table} FOR EACH STATEMENT EXECUTE FUNCTION parity_backfill_fault()"
        )
    };
    sqlx::query(&statement)
        .execute(&lab.db)
        .await
        .expect("fault trigger");
}
