use super::*;

const WRITE: Uuid = Uuid::from_u128(0x6000_0000_0000_0000_0000_0000_0000_0001);
const NEWER: Uuid = Uuid::from_u128(0x6000_0000_0000_0000_0000_0000_0000_0002);

#[derive(Clone, Copy)]
enum Edge {
    MissingSingle,
    MissingBatch,
    PartialTransient,
    BatchWithWaiting,
    PartialWithWaiting,
    ExpiredOwn,
    LegacyEmpty,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Worker edge fixtures use uncached runtime SQL"
)]
async fn edge(pool: PgPool, name: &'static str, shard: u32, retry: bool, edge: Edge) {
    let mut lab = start(pool, name, shard).await;
    lab.transcript.normalizer.symbol(WRITE, "<write:older>");
    lab.transcript.normalizer.symbol(NEWER, "<write:newer>");
    let queue = if retry {
        Queue::GmailOpsRetry
    } else {
        Queue::GmailOps
    };
    match edge {
        Edge::MissingSingle | Edge::MissingBatch | Edge::PartialTransient | Edge::ExpiredOwn => {
            let names = if matches!(edge, Edge::MissingSingle | Edge::ExpiredOwn) {
                vec!["m1a"]
            } else {
                vec!["m1a", "m1b"]
            };
            mark(&mut lab, &names, WRITE, true, "Label_work").await;
            if matches!(edge, Edge::ExpiredOwn) {
                sqlx::query("UPDATE email_gmail_pending_label_writes SET expires_at=now()-interval '1 hour'").execute(&lab.db).await.expect("expire own marker");
            } else {
                let (target, status) = if matches!(edge, Edge::PartialTransient) {
                    ("messages/m1b/modify", 503)
                } else {
                    ("messages/m1a/modify", 404)
                };
                script(&lab, "POST", target, rejection(status));
            }
            let message = delivery(
                &lab,
                label_operation(
                    &lab,
                    &names,
                    Some(WRITE),
                    names.len() == 1,
                    "Label_work",
                    true,
                ),
            );
            let first = lab.worker_step("first delivery", queue, &message).await;
            first.result.expect("handled provider answer");
            lab.reset_admission().await;
            let again = first
                .sent
                .first()
                .map(Delivery::from_sent)
                .unwrap_or_else(|| message.redelivered());
            lab.worker_step(
                "redelivery",
                if first.sent.is_empty() {
                    queue
                } else {
                    Queue::GmailOpsRetry
                },
                &again,
            )
            .await
            .result
            .expect("redelivery handled");
        }
        Edge::BatchWithWaiting | Edge::PartialWithWaiting => {
            let count = if matches!(edge, Edge::BatchWithWaiting) {
                11
            } else {
                3
            };
            let names = extend_messages(&mut lab, shard, count).await;
            let names: Vec<_> = names.iter().map(String::as_str).collect();
            mark(&mut lab, &names, WRITE, true, "Label_work").await;
            mark(&mut lab, &[names[count - 1]], NEWER, false, "Label_work").await;
            let path = if count == 11 {
                "messages/batchModify"
            } else {
                "messages/m1b/modify"
            };
            script(&lab, "POST", path, rejection(400));
            let message = delivery(
                &lab,
                label_operation(&lab, &names, Some(WRITE), false, "Label_work", true),
            );
            lab.worker_step(
                "permanent rejection includes waiting messages",
                queue,
                &message,
            )
            .await
            .result
            .expect("reverted");
        }
        Edge::LegacyEmpty => {
            let message = delivery(
                &lab,
                label_operation(&lab, &[], None, false, "Label_work", true),
            );
            lab.worker_step("unmarked empty batch", queue, &message)
                .await
                .result
                .expect("empty legacy batch");
        }
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn missing_single_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "missing_single_primary",
        63000,
        false,
        Edge::MissingSingle,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn missing_single_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "missing_single_retry",
        63003,
        true,
        Edge::MissingSingle,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn missing_batch_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "missing_batch_primary",
        63006,
        false,
        Edge::MissingBatch,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn missing_batch_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(pool, "missing_batch_retry", 63009, true, Edge::MissingBatch).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn partial_transient_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "partial_transient_primary",
        63012,
        false,
        Edge::PartialTransient,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn partial_transient_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "partial_transient_retry",
        63015,
        true,
        Edge::PartialTransient,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_with_waiting_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "batch_with_waiting_primary",
        63018,
        false,
        Edge::BatchWithWaiting,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_with_waiting_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "batch_with_waiting_retry",
        63021,
        true,
        Edge::BatchWithWaiting,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn partial_with_waiting_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "partial_with_waiting_primary",
        63024,
        false,
        Edge::PartialWithWaiting,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn partial_with_waiting_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "partial_with_waiting_retry",
        63027,
        true,
        Edge::PartialWithWaiting,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn expired_own_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(pool, "expired_own_primary", 63030, false, Edge::ExpiredOwn).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn expired_own_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(pool, "expired_own_retry", 63033, true, Edge::ExpiredOwn).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn legacy_empty_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(
        pool,
        "legacy_empty_primary",
        63036,
        false,
        Edge::LegacyEmpty,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn legacy_empty_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    edge(pool, "legacy_empty_retry", 63039, true, Edge::LegacyEmpty).await;
}
