//! Characterization of the unmodified inbox-sync delivery path.

use crate::parity::lab::worker::{Delivery, Queue};
use crate::parity::lab::{Lab, LabOptions};
use crate::pubsub::label_write_sim::fake_gmail::{GmailMessage, HttpReply};
use models_email::gmail::inbox_sync::{
    DeleteMessagePayload, GmailMessagePayload, InboxSyncOperation, InboxSyncPubsubMessage,
    UpdateLabelsPayload, UpsertMessagePayload,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

macro_rules! cases {
    ($runner:ident; $( $name:ident, $shard:literal, $retry:literal, $case:expr; )*) => {
        $(
            #[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
            async fn $name(pool: PgPool) {
                if !crate::parity::process_per_test() { return; }
                run_case(move || $runner(pool, stringify!($name), $shard, $retry, $case)).await;
            }
        )*
    };
}

// SQLx's current-thread test executor otherwise polls production's spawned task
// under the fixture's block_on stack. Production polls it on a runtime worker.
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
            .expect("worker runtime")
            .block_on(build());
    })
    .await
    .expect("scenario task");
}

mod admission;
mod attachments;
mod calendar;
mod deletion;
mod effects;
mod envelope;
mod history;
mod history_edges;
mod labels;
mod notifications;
mod providers;
mod resync;
mod upsert;

#[expect(
    clippy::disallowed_methods,
    reason = "Normalize only this suite fixture to the history lookup contract"
)]
async fn start(pool: PgPool, name: &'static str, shard: u32) -> Lab {
    let mut lab = Lab::start_worker_lab(
        pool,
        LabOptions {
            suite: "inbox_sync_worker",
            name,
            shard,
            gmail_label_write_batches: true,
        },
    )
    .await;
    sqlx::query("UPDATE email_links SET email_address=lower(email_address)")
        .execute(&lab.db)
        .await
        .expect("lowercase inbox addresses");
    for link in lab.fixture.links {
        lab.seed_link_token(link).await;
    }
    for (millis, symbol) in [
        (1_790_000_000_000, "<time:provider>"),
        (1_790_000_090_000, "<time:later-sent>"),
        (1_790_000_100_000, "<time:latest-spam>"),
    ] {
        let date = chrono::DateTime::from_timestamp_millis(millis).expect("fixture timestamp");
        lab.transcript.normalizer.symbol(date.to_rfc3339(), symbol);
        lab.transcript.normalizer.symbol(
            date.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true),
            symbol,
        );
        lab.transcript
            .normalizer
            .symbol(format!("{date:?}"), symbol);
        lab.transcript.normalizer.symbol(format!("{date}"), symbol);
    }
    lab.start_workers().await;
    lab.inbox_notifications(false);
    lab.stub.reply(
        "GET",
        "/internal/google_access_token",
        200,
        json!({"access_token":"fake-access-token"}),
    );
    lab.stub
        .reply("POST", "/message/send/", 200, json!({"receipts":[]}));
    lab
}

fn queue(retry: bool) -> Queue {
    if retry {
        Queue::InboxSyncRetry
    } else {
        Queue::InboxSync
    }
}

#[derive(Clone, Copy)]
enum Op {
    History,
    Upsert,
    Labels,
    Delete,
}
impl Op {
    fn operation(self, id: &str) -> InboxSyncOperation {
        match self {
            Self::History => {
                InboxSyncOperation::GmailMessage(GmailMessagePayload { history_id: 200 })
            }
            Self::Upsert => InboxSyncOperation::UpsertMessage(UpsertMessagePayload {
                provider_message_id: id.into(),
            }),
            Self::Labels => InboxSyncOperation::UpdateLabels(UpdateLabelsPayload {
                provider_message_id: id.into(),
            }),
            Self::Delete => InboxSyncOperation::DeleteMessage(DeleteMessagePayload {
                provider_message_id: id.into(),
            }),
        }
    }
}

fn delivery(lab: &Lab, op: Op, id: &str) -> Delivery {
    Delivery::new(
        serde_json::to_string(&InboxSyncPubsubMessage {
            link_id: lab.fixture.links[0],
            operation: op.operation(id),
        })
        .expect("operation JSON"),
    )
}
fn persistent(lab: &Lab, path: &str, status: u16, body: Value) {
    lab.gmail.lock().endpoint_replies.insert(
        format!("/gmail/v1/users/me/{path}"),
        [(status, body)].into(),
    );
}
fn catalog() -> Value {
    json!({"labels": (["INBOX","UNREAD","STARRED","TRASH","SPAM","SENT","Label_work"].into_iter().map(|id|json!({
        "id":id,"name":if id=="Label_work"{"Work"}else{id},"type":if id=="Label_work"{"user"}else{"system"},
        "messageListVisibility":"show","labelListVisibility":"labelShow"
    })).collect::<Vec<_>>())})
}

fn rejection(status: u16) -> Value {
    json!({"error":{"code":status,"message":"scripted provider rejection"}})
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
fn provider_message(lab: &Lab, id: &str, thread: &str, labels: &[&str]) {
    lab.gmail.lock().messages.insert(
        id.into(),
        GmailMessage {
            thread_id: thread.into(),
            labels: labels.iter().map(|s| s.to_string()).collect(),
            internal_date_ms: 1_790_000_000_000,
        },
    );
    persistent(
        lab,
        &format!("messages/{id}"),
        200,
        full_message(id, thread, labels),
    );
}

#[expect(
    clippy::disallowed_methods,
    reason = "Characterization uses runtime fixture SQL without cache entries"
)]
async fn seed_history(lab: &Lab, history: &str) {
    sqlx::query("INSERT INTO email_gmail_histories (link_id,history_id) VALUES($1,$2) ON CONFLICT(link_id) DO UPDATE SET history_id=excluded.history_id")
        .bind(lab.fixture.links[0]).bind(history).execute(&lab.db).await.expect("history fixture");
}

#[expect(
    clippy::disallowed_methods,
    reason = "Faults are confined to the isolated characterization database"
)]
async fn trigger(lab: &Lab, table: &str, operation: &str, commit: bool) {
    sqlx::query("CREATE FUNCTION parity_inbox_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity injected inbox failure'; END $$")
        .execute(&lab.db).await.expect("fault function");
    let statement = if commit {
        format!(
            "CREATE CONSTRAINT TRIGGER parity_inbox_fault AFTER {operation} ON {table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION parity_inbox_fault()"
        )
    } else {
        format!(
            "CREATE TRIGGER parity_inbox_fault BEFORE {operation} ON {table} FOR EACH STATEMENT EXECUTE FUNCTION parity_inbox_fault()"
        )
    };
    sqlx::query(&statement)
        .execute(&lab.db)
        .await
        .expect("fault trigger");
}

async fn duplicate(lab: &mut Lab, retry: bool, message: &Delivery) {
    lab.reset_admission().await;
    lab.worker_step("duplicate delivery", queue(retry), &message.redelivered())
        .await
        .result
        .expect("duplicate handled");
}
