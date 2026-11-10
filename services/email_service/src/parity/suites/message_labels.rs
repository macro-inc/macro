use super::super::lab::{Auth, Lab, LabOptions, RequestBody};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

mod additional;

impl Lab {
    async fn labels(&mut self, name: &str, auth: Auth, body: serde_json::Value) -> u16 {
        self.request(
            name,
            "PATCH",
            "/email/messages/labels",
            auth,
            RequestBody::Json(body),
        )
        .await
    }
}

enum Scenario {
    Add,
    RemoveAndNoop,
    Unread,
    Starred,
    Threads,
    Draft,
    Missing,
    Invalid,
    Forbidden,
    Delegated,
    Callers,
    QueueOutage,
    RevertFailure,
    ResolveFailure,
    LabelFailure,
    MessagesFailure,
    BeginFailure,
    TransactionFailure,
    CommitFailure,
    Retry,
    Supersede,
    MixedAFirst,
    MixedA2First,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Fault injection uses runtime test SQL and must not create SQLx cache entries"
)]
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
    let m1a = lab.fixture.messages["m1a"];
    let m1b = lab.fixture.messages["m1b"];
    let m2a = lab.fixture.messages["m2a"];
    let work = lab.fixture.labels["A/Label_work"];
    let unread = lab.fixture.labels["A/UNREAD"];
    let starred = lab.fixture.labels["A/STARRED"];
    let unknown = Uuid::from_u128(0x9000_0000_0000_0000_0000_0000_0000_0001);
    lab.transcript.normalizer.symbol(unknown, "<missing>");
    let body = |ids: Vec<Uuid>, label: Uuid, value: bool| json!({"message_ids":ids,"label_id":label,"value":value});
    match scenario {
        Scenario::Add => {
            assert_eq!(
                lab.labels("add to two messages", a, body(vec![m1a, m1b], work, true))
                    .await,
                200
            );
        }
        Scenario::RemoveAndNoop => {
            let already = lab.fixture.messages["m3a"];
            assert_eq!(
                lab.labels(
                    "add with one already labeled",
                    a,
                    body(vec![m1a, already], work, true)
                )
                .await,
                200
            );
            assert_eq!(
                lab.labels("remove label", a, body(vec![m1a, already], work, false))
                    .await,
                200
            );
            assert_eq!(
                lab.labels(
                    "remove absent label",
                    a,
                    body(vec![m1a, already], work, false)
                )
                .await,
                200
            );
        }
        Scenario::Unread => {
            assert_eq!(
                lab.labels("mark unread", a, body(vec![m1a, m1b], unread, true))
                    .await,
                200
            );
            assert_eq!(
                lab.labels("mark read", a, body(vec![m1a, m1b], unread, false))
                    .await,
                200
            );
        }
        Scenario::Starred => {
            assert_eq!(
                lab.labels("star", a, body(vec![m1a, m1b], starred, true))
                    .await,
                200
            );
            assert_eq!(
                lab.labels("unstar", a, body(vec![m1a, m1b], starred, false))
                    .await,
                200
            );
        }
        Scenario::Threads => {
            let trash = lab.fixture.labels["A/TRASH"];
            assert_eq!(
                lab.labels("two threads", a, body(vec![m1a, m1b, m2a], trash, true))
                    .await,
                200
            );
        }
        Scenario::Draft => {
            let draft = lab.fixture.messages["draft"];
            assert_eq!(
                lab.labels(
                    "provider message and local draft",
                    a,
                    body(vec![m1a, draft], work, true)
                )
                .await,
                200
            );
        }
        Scenario::Missing => {
            assert_eq!(
                lab.labels(
                    "one missing message",
                    a,
                    body(vec![m1a, unknown], work, true)
                )
                .await,
                200
            );
            assert_eq!(
                lab.labels("all messages missing", a, body(vec![unknown], work, true))
                    .await,
                404
            );
        }
        Scenario::Invalid => {
            assert_eq!(
                lab.labels("empty batch", a, body(vec![], work, true)).await,
                400
            );
            assert_eq!(
                lab.labels("eleven messages", a, body(vec![m1a; 11], work, true))
                    .await,
                400
            );
            assert_eq!(
                lab.labels("unknown label", a, body(vec![m1a], unknown, true))
                    .await,
                400
            );
            let foreign = lab.fixture.labels["B/Label_work"];
            assert_eq!(
                lab.labels(
                    "label from another inbox",
                    a,
                    body(vec![m1a], foreign, true)
                )
                .await,
                400
            );
        }
        Scenario::Forbidden => {
            assert_eq!(
                lab.labels("unrelated user", Auth::User(2), body(vec![m1a], work, true))
                    .await,
                404
            );
        }
        Scenario::Delegated => {
            let message = lab.fixture.messages["b1a"];
            let label = lab.fixture.labels["B/Label_work"];
            // Capture the current handler, including its different inbox and
            // message authorization queries. Do not repair behavior in the lab.
            assert_eq!(
                lab.labels("delegated inbox", a, body(vec![message], label, true))
                    .await,
                200
            );
        }
        Scenario::Callers => {
            assert_eq!(
                lab.labels(
                    "internal caller",
                    Auth::Internal,
                    body(vec![m1a], work, true)
                )
                .await,
                200
            );
            assert_eq!(
                lab.labels(
                    "unauthenticated",
                    Auth::InvalidBearer,
                    body(vec![m1b], work, true)
                )
                .await,
                401
            );
        }
        Scenario::QueueOutage => {
            lab.sqs.set_outage(true);
            assert_eq!(
                lab.labels(
                    "enqueue fails and reverts",
                    a,
                    body(vec![m1a, m1b], work, true)
                )
                .await,
                200
            );
        }
        Scenario::RevertFailure => {
            sqlx::raw_sql("CREATE FUNCTION parity_revert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity injected revert failure'; END $$; CREATE TRIGGER parity_revert_failure BEFORE DELETE ON email_gmail_pending_label_writes FOR EACH ROW EXECUTE FUNCTION parity_revert_failure();")
                .execute(&lab.db).await.expect("revert fault");
            lab.sqs.set_outage(true);
            assert_eq!(
                lab.labels("enqueue and revert fail", a, body(vec![m1a], work, true))
                    .await,
                500
            );
        }
        Scenario::ResolveFailure => {
            sqlx::query("ALTER TABLE email_links RENAME TO parity_hidden_links")
                .execute(&lab.db)
                .await
                .expect("resolve fault");
            assert_eq!(
                lab.labels(
                    "resolve inbox database failure",
                    a,
                    body(vec![m1a], work, true)
                )
                .await,
                500
            );
        }
        Scenario::LabelFailure => {
            sqlx::query("ALTER TABLE email_labels RENAME TO parity_hidden_labels")
                .execute(&lab.db)
                .await
                .expect("label fault");
            assert_eq!(
                lab.labels(
                    "fetch label database failure",
                    a,
                    body(vec![m1a], work, true)
                )
                .await,
                500
            );
        }
        Scenario::MessagesFailure => {
            sqlx::query(
                "ALTER TABLE email_messages RENAME COLUMN snippet TO parity_hidden_snippet",
            )
            .execute(&lab.db)
            .await
            .expect("messages fault");
            assert_eq!(
                lab.labels(
                    "fetch messages database failure",
                    a,
                    body(vec![m1a], work, true)
                )
                .await,
                500
            );
        }
        Scenario::BeginFailure => {
            lab.sql_fault.fail_acquisition(4);
            assert_eq!(
                lab.labels(
                    "begin transaction database failure",
                    a,
                    body(vec![m1a], work, true)
                )
                .await,
                500
            );
        }
        Scenario::TransactionFailure => {
            sqlx::query(
                "ALTER TABLE email_gmail_pending_label_writes RENAME TO parity_hidden_writes",
            )
            .execute(&lab.db)
            .await
            .expect("transaction fault");
            assert_eq!(
                lab.labels(
                    "transaction body database failure",
                    a,
                    body(vec![m1a], work, true)
                )
                .await,
                500
            );
        }
        Scenario::CommitFailure => {
            sqlx::raw_sql("CREATE FUNCTION parity_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity injected commit failure'; END $$; CREATE CONSTRAINT TRIGGER parity_commit_failure AFTER INSERT ON email_gmail_pending_label_writes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION parity_commit_failure();")
                .execute(&lab.db).await.expect("commit fault");
            assert_eq!(
                lab.labels("commit database failure", a, body(vec![m1a], work, true))
                    .await,
                500
            );
        }
        Scenario::Retry => {
            assert_eq!(
                lab.labels("first request", a, body(vec![m1a], work, true))
                    .await,
                200
            );
            assert_eq!(
                lab.labels("same request again", a, body(vec![m1a], work, true))
                    .await,
                200
            );
        }
        Scenario::MixedAFirst => {
            let other = lab.fixture.messages["a2a"];
            assert_eq!(
                lab.labels("owned inbox A first", a, body(vec![m1a, other], work, true))
                    .await,
                200
            );
        }
        Scenario::MixedA2First => {
            let other = lab.fixture.messages["a2a"];
            let other_label = lab.fixture.labels["A2/Label_work"];
            assert_eq!(
                lab.labels(
                    "owned inbox A2 first",
                    a,
                    body(vec![other, m1a], other_label, true)
                )
                .await,
                200
            );
        }
        Scenario::Supersede => {
            assert_eq!(lab.labels("add", a, body(vec![m1a], work, true)).await, 200);
            assert_eq!(
                lab.labels(
                    "remove supersedes pending add",
                    a,
                    body(vec![m1a], work, false)
                )
                .await,
                200
            );
        }
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn add_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20000, false, "add_single", Scenario::Add).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn add_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20003, true, "add_batch", Scenario::Add).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn remove_and_noop_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20006,
        false,
        "remove_and_noop_single",
        Scenario::RemoveAndNoop,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn remove_and_noop_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20009,
        true,
        "remove_and_noop_batch",
        Scenario::RemoveAndNoop,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn unread_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20012, false, "unread_single", Scenario::Unread).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn unread_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20015, true, "unread_batch", Scenario::Unread).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn starred_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20018, false, "starred_single", Scenario::Starred).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn starred_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20021, true, "starred_batch", Scenario::Starred).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn threads_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20024, false, "threads_single", Scenario::Threads).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn threads_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20027, true, "threads_batch", Scenario::Threads).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn draft_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20030, false, "draft_single", Scenario::Draft).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn draft_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20033, true, "draft_batch", Scenario::Draft).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn missing_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20036, false, "missing_single", Scenario::Missing).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn missing_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20039, true, "missing_batch", Scenario::Missing).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn invalid_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20042, false, "invalid_single", Scenario::Invalid).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn invalid_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20045, true, "invalid_batch", Scenario::Invalid).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn forbidden_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20048, false, "forbidden_single", Scenario::Forbidden).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn forbidden_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20051, true, "forbidden_batch", Scenario::Forbidden).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delegated_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20054, false, "delegated_single", Scenario::Delegated).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delegated_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20057, true, "delegated_batch", Scenario::Delegated).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn callers_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20060, false, "callers_single", Scenario::Callers).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn callers_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20063, true, "callers_batch", Scenario::Callers).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn queue_outage_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20066,
        false,
        "queue_outage_single",
        Scenario::QueueOutage,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn queue_outage_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20069,
        true,
        "queue_outage_batch",
        Scenario::QueueOutage,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn revert_failure_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20072,
        false,
        "revert_failure_single",
        Scenario::RevertFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn revert_failure_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20075,
        true,
        "revert_failure_batch",
        Scenario::RevertFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn resolve_failure_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20078,
        false,
        "resolve_failure_single",
        Scenario::ResolveFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn resolve_failure_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20081,
        true,
        "resolve_failure_batch",
        Scenario::ResolveFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn label_failure_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20084,
        false,
        "label_failure_single",
        Scenario::LabelFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn label_failure_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20087,
        true,
        "label_failure_batch",
        Scenario::LabelFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn messages_failure_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20090,
        false,
        "messages_failure_single",
        Scenario::MessagesFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn messages_failure_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20093,
        true,
        "messages_failure_batch",
        Scenario::MessagesFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn transaction_failure_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20096,
        false,
        "transaction_failure_single",
        Scenario::TransactionFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn transaction_failure_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20099,
        true,
        "transaction_failure_batch",
        Scenario::TransactionFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn commit_failure_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20102,
        false,
        "commit_failure_single",
        Scenario::CommitFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn commit_failure_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20105,
        true,
        "commit_failure_batch",
        Scenario::CommitFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn retry_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20108, false, "retry_single", Scenario::Retry).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn retry_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20111, true, "retry_batch", Scenario::Retry).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn supersede_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20114, false, "supersede_single", Scenario::Supersede).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn supersede_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, 20117, true, "supersede_batch", Scenario::Supersede).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn mixed_a_first_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20120,
        false,
        "mixed_a_first_single",
        Scenario::MixedAFirst,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn mixed_a_first_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20123,
        true,
        "mixed_a_first_batch",
        Scenario::MixedAFirst,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn mixed_a2_first_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20126,
        false,
        "mixed_a2_first_single",
        Scenario::MixedA2First,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn mixed_a2_first_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20129,
        true,
        "mixed_a2_first_batch",
        Scenario::MixedA2First,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn begin_failure_single(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20200,
        false,
        "begin_failure_single",
        Scenario::BeginFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn begin_failure_batch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        20203,
        true,
        "begin_failure_batch",
        Scenario::BeginFailure,
    )
    .await;
}
