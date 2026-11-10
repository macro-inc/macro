use super::{Auth, Lab, LabOptions, RequestBody};
use crate::pubsub::label_write_sim::{fake_gmail::GmailMessage, world};
use serde_json::json;
use sqlx::PgPool;

enum Scenario {
    UnreadOutage,
    StarredOutage,
    PartialBatchFailure,
    OlderPendingOutage,
    Malformed,
    MaximumBatch,
    RollbackFailure,
}

async fn run(pool: PgPool, shard: u32, batches: bool, name: &'static str, scenario: Scenario) {
    let mut lab = Lab::start(
        pool,
        LabOptions {
            suite: "message_labels",
            name,
            shard,
            gmail_label_write_batches: batches,
        },
    )
    .await;
    let a = Auth::User(0);
    let first = lab.fixture.messages["m1a"];
    let second = lab.fixture.messages["m1b"];
    let other_thread = lab.fixture.messages["m2a"];
    let work = lab.fixture.labels["A/Label_work"];
    let body = |ids, label, value| json!({"message_ids":ids,"label_id":label,"value":value});
    match scenario {
        Scenario::UnreadOutage => {
            lab.sqs.set_outage(true);
            let unread = lab.fixture.labels["A/UNREAD"];
            assert_eq!(
                lab.labels(
                    "remove unread while queue is down",
                    a,
                    body(vec![first, other_thread], unread, false)
                )
                .await,
                200
            );
        }
        Scenario::StarredOutage => {
            lab.sqs.set_outage(true);
            let starred = lab.fixture.labels["A/STARRED"];
            assert_eq!(
                lab.labels(
                    "add starred while queue is down",
                    a,
                    body(vec![first, other_thread], starred, true)
                )
                .await,
                200
            );
        }
        Scenario::PartialBatchFailure => {
            // The single-message write form uses one real SendMessageBatch.
            // Fail its second entry, retaining the first queued operation.
            lab.sqs.fail_nth_send(2);
            assert_eq!(
                lab.labels(
                    "second batch entry fails",
                    a,
                    body(vec![first, second], work, true)
                )
                .await,
                200
            );
            assert_eq!(lab.sqs.lock().sent.len(), 1);
            assert_eq!(lab.sqs.lock().failed_sends.len(), 1);
        }
        Scenario::OlderPendingOutage => {
            assert_eq!(
                lab.labels(
                    "queued pending add",
                    a,
                    body(vec![first, second], work, true)
                )
                .await,
                200
            );
            lab.sqs.set_outage(true);
            assert_eq!(
                lab.labels(
                    "remove fails with older pending add",
                    a,
                    body(vec![first, second], work, false)
                )
                .await,
                200
            );
        }
        Scenario::Malformed => {
            assert_eq!(
                lab.request(
                    "non-JSON body",
                    "PATCH",
                    "/email/messages/labels",
                    a,
                    RequestBody::Raw {
                        bytes: b"not JSON".to_vec(),
                        content_type: "application/json"
                    }
                )
                .await,
                400
            );
            assert_eq!(
                lab.request(
                    "invalid UUID",
                    "PATCH",
                    "/email/messages/labels",
                    a,
                    RequestBody::Json(
                        json!({"message_ids":["not-a-uuid"],"label_id":work,"value":true})
                    )
                )
                .await,
                422
            );
        }
        Scenario::MaximumBatch => {
            add_boundary_messages(&mut lab, shard).await;
            let ids = [
                "m1a",
                "m1b",
                "m1c",
                "m2a",
                "m2b",
                "m3a",
                "maximum-1",
                "maximum-2",
                "maximum-3",
                "maximum-4",
            ]
            .map(|name| lab.fixture.messages[name])
            .to_vec();
            assert_eq!(
                lab.labels("ten messages accepted", a, body(ids, work, true))
                    .await,
                200
            );
        }
        Scenario::RollbackFailure => {
            // Terminate only this statement's own backend. Both the transaction
            // body and the subsequent rollback then use the closed connection.
            sqlx::raw_sql("CREATE FUNCTION parity_rollback_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END $$; CREATE TRIGGER parity_rollback_failure BEFORE INSERT ON email_gmail_pending_label_writes FOR EACH ROW EXECUTE FUNCTION parity_rollback_failure();")
                .execute(&lab.db).await.expect("rollback fault");
            assert_eq!(
                lab.labels(
                    "rollback loses its backend",
                    a,
                    body(vec![first], work, true)
                )
                .await,
                500
            );
        }
    }
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "The boundary fixture uses runtime test queries without SQLx cache entries"
)]
async fn add_boundary_messages(lab: &mut Lab, shard: u32) {
    let thread = world::thread_uuid(shard, 2);
    let link = lab.fixture.links[0];
    for index in 0..4 {
        let name = format!("maximum-{}", index + 1);
        let id = world::message_uuid(shard, 7 + index);
        let date = 1_790_000_600_000_i64 + index as i64 * 60_000;
        sqlx::query("INSERT INTO email_messages (id,thread_id,link_id,provider_id,provider_thread_id,is_read,is_starred,is_sent,is_draft,has_attachments,internal_date_ts) VALUES ($1,$2,$3,$4,'t3',false,false,false,false,false,to_timestamp($5::double precision/1000))")
            .bind(id).bind(thread).bind(link).bind(&name).bind(date as f64)
            .execute(&lab.db).await.expect("maximum-batch message");
        for label in ["INBOX", "UNREAD"] {
            sqlx::query("INSERT INTO email_message_labels (message_id,label_id) VALUES ($1,$2)")
                .bind(id)
                .bind(lab.fixture.labels[&format!("A/{label}")])
                .execute(&lab.db)
                .await
                .expect("maximum-batch label");
        }
        lab.transcript
            .normalizer
            .symbol(id, format!("<msg:{name}>"));
        lab.fixture.messages.insert(name.clone(), id);
        lab.gmail.lock().messages.insert(
            name,
            GmailMessage {
                thread_id: "t3".into(),
                labels: ["INBOX".into(), "UNREAD".into()].into(),
                internal_date_ms: date,
            },
        );
    }
    let mut connection = lab.db.acquire().await.expect("fixture connection");
    email_db_client::threads::update::update_thread_metadata(&mut connection, thread, link)
        .await
        .expect("maximum-batch metadata");
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn unread_outage_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22000,
        false,
        "unread_outage_single",
        Scenario::UnreadOutage,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn unread_outage_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22003,
        true,
        "unread_outage_batch",
        Scenario::UnreadOutage,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn starred_outage_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22006,
        false,
        "starred_outage_single",
        Scenario::StarredOutage,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn starred_outage_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22009,
        true,
        "starred_outage_batch",
        Scenario::StarredOutage,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn partial_batch_failure_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22012,
        false,
        "partial_batch_failure_single",
        Scenario::PartialBatchFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn older_pending_outage_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22015,
        false,
        "older_pending_outage_single",
        Scenario::OlderPendingOutage,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn older_pending_outage_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22018,
        true,
        "older_pending_outage_batch",
        Scenario::OlderPendingOutage,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn malformed_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 22021, false, "malformed_single", Scenario::Malformed).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn malformed_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 22024, true, "malformed_batch", Scenario::Malformed).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn maximum_batch_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22027,
        false,
        "maximum_batch_single",
        Scenario::MaximumBatch,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn maximum_batch_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22030,
        true,
        "maximum_batch_batch",
        Scenario::MaximumBatch,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn rollback_failure_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22033,
        false,
        "rollback_failure_single",
        Scenario::RollbackFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn rollback_failure_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        22036,
        true,
        "rollback_failure_batch",
        Scenario::RollbackFailure,
    )
    .await;
}
