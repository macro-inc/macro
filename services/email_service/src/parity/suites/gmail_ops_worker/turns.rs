use super::*;
use crate::pubsub::label_write_sim::fake_gmail::{Kind, PauseAt};

const WRITE: Uuid = Uuid::from_u128(0x6000_0000_0000_0000_0000_0000_0000_0001);
const NEWER: Uuid = Uuid::from_u128(0x6000_0000_0000_0000_0000_0000_0000_0002);

#[derive(Clone, Copy)]
enum Turn {
    Newest,
    Superseded,
    Expired,
    Waiting,
    WaitingQueueFailure,
    PartialRevert,
    BatchRevert,
    NewerDuringSend,
    SupersededDuringSend,
    Nine,
    Ten,
    Maximum,
    Empty,
    NoLabels,
    LegacyUnread,
    LegacyStarred,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Turn fixtures use runtime SQL and isolated marker mutations"
)]
async fn turns(pool: PgPool, name: &'static str, shard: u32, retry: bool, turn: Turn) {
    let mut lab = start(pool, name, shard).await;
    lab.transcript.normalizer.symbol(WRITE, "<write:older>");
    lab.transcript.normalizer.symbol(NEWER, "<write:newer>");
    let queue = if retry {
        Queue::GmailOpsRetry
    } else {
        Queue::GmailOps
    };
    match turn {
        Turn::Newest
        | Turn::Superseded
        | Turn::Expired
        | Turn::Waiting
        | Turn::WaitingQueueFailure => {
            mark(&mut lab, &["m1a"], WRITE, true, "Label_work").await;
            let message = delivery(
                &lab,
                label_operation(&lab, &["m1a"], Some(WRITE), true, "Label_work", true),
            );
            if !matches!(turn, Turn::Newest) {
                mark(&mut lab, &["m1a"], NEWER, false, "Label_work").await;
            }
            if matches!(turn, Turn::Superseded) {
                let newest = delivery(
                    &lab,
                    label_operation(&lab, &["m1a"], Some(NEWER), true, "Label_work", false),
                );
                lab.worker_step("newer write confirmed", queue, &newest)
                    .await
                    .result
                    .expect("confirmed");
                lab.reset_admission().await;
            }
            if matches!(turn, Turn::Expired) {
                sqlx::query("UPDATE email_gmail_pending_label_writes SET expires_at=now()-interval '1 hour' WHERE write_id=$1")
                    .bind(NEWER).execute(&lab.db).await.expect("expired newer marker");
            }
            if matches!(turn, Turn::WaitingQueueFailure) {
                lab.sqs.set_outage(true);
            }
            let first = lab.worker_step("older delivery", queue, &message).await;
            first.result.expect("handled older delivery");
            lab.sqs.set_outage(false);
            if matches!(turn, Turn::Waiting | Turn::WaitingQueueFailure) {
                let newest = delivery(
                    &lab,
                    label_operation(&lab, &["m1a"], Some(NEWER), true, "Label_work", false),
                );
                script(&lab, "POST", "messages/m1a/modify", rejection(400));
                lab.worker_step("newer write rejected", queue, &newest)
                    .await
                    .result
                    .expect("rejected");
                lab.reset_admission().await;
                let again = first
                    .sent
                    .first()
                    .map(Delivery::from_sent)
                    .unwrap_or_else(|| message.redelivered());
                let resume_queue = if first.sent.is_empty() {
                    queue
                } else {
                    Queue::GmailOpsRetry
                };
                lab.worker_step("waiting write resumes", resume_queue, &again)
                    .await
                    .result
                    .expect("resumed");
            } else {
                lab.reset_admission().await;
                lab.worker_step("duplicate delivery", queue, &message.redelivered())
                    .await
                    .result
                    .expect("duplicate");
            }
        }
        Turn::PartialRevert => {
            let names = ["m1a", "m1b", "m1c"];
            mark(&mut lab, &names, WRITE, true, "Label_work").await;
            let message = delivery(
                &lab,
                label_operation(&lab, &names, Some(WRITE), false, "Label_work", true),
            );
            script(&lab, "POST", "messages/m1b/modify", rejection(400));
            lab.worker_step("second message permanently rejected", queue, &message)
                .await
                .result
                .expect("handled rejection");
            lab.reset_admission().await;
            lab.worker_step(
                "duplicate already reverted write",
                queue,
                &message.redelivered(),
            )
            .await
            .result
            .expect("duplicate");
        }
        Turn::BatchRevert | Turn::Nine | Turn::Ten | Turn::Maximum => {
            let count = match turn {
                Turn::Nine => 9,
                Turn::Maximum => 1000,
                _ => 10,
            };
            let names = extend_messages(&mut lab, shard, count).await;
            let names: Vec<_> = names.iter().map(String::as_str).collect();
            mark(&mut lab, &names, WRITE, true, "Label_work").await;
            let message = delivery(
                &lab,
                label_operation(&lab, &names, Some(WRITE), false, "Label_work", true),
            );
            if matches!(turn, Turn::BatchRevert) {
                script(&lab, "POST", "messages/batchModify", rejection(403));
            }
            lab.worker_step("batch delivery", queue, &message)
                .await
                .result
                .expect("batch handled");
            lab.reset_admission().await;
            lab.worker_step("batch duplicate", queue, &message.redelivered())
                .await
                .result
                .expect("duplicate");
        }
        Turn::NewerDuringSend | Turn::SupersededDuringSend => {
            mark(&mut lab, &["m1a", "m1b"], WRITE, true, "Label_work").await;
            let message = delivery(
                &lab,
                label_operation(
                    &lab,
                    &["m1a", "m1b"],
                    Some(WRITE),
                    false,
                    "Label_work",
                    true,
                ),
            );
            let pause = lab
                .gmail
                .pause_next(Kind::Write, Some("m1a"), PauseAt::AfterApply);
            let db = lab.db.clone();
            let link = lab.fixture.links[0];
            let second = lab.fixture.messages["m1b"];
            let change = async move {
                pause.arrived.await.expect("first Gmail write arrived");
                email_db_client::labels::pending_writes::mark_pending_label_writes(
                    &db,
                    link,
                    &[second],
                    "Label_work",
                    false,
                    NEWER,
                )
                .await
                .expect("concurrent marker");
                if matches!(turn, Turn::SupersededDuringSend) {
                    let mut tx = db.begin().await.expect("fixture transaction");
                    email_db_client::labels::pending_writes::confirm_pending_label_writes(
                        &mut tx,
                        &[second],
                        NEWER,
                    )
                    .await
                    .expect("confirm concurrent marker");
                    tx.commit().await.expect("commit concurrent marker");
                }
                pause.release.send(()).expect("release first write");
            };
            let (result, ()) = futures::join!(
                lab.worker_step("newer write while first message sends", queue, &message),
                change
            );
            result.result.expect("handled changed turn");
        }
        Turn::Empty => {
            let message = delivery(
                &lab,
                label_operation(&lab, &[], Some(WRITE), false, "Label_work", true),
            );
            lab.worker_step("empty marked batch", queue, &message)
                .await
                .result
                .expect("empty batch");
        }
        Turn::NoLabels | Turn::LegacyUnread | Turn::LegacyStarred => {
            let label = match turn {
                Turn::LegacyUnread => "UNREAD",
                Turn::LegacyStarred => "STARRED",
                _ => "Label_work",
            };
            for add in [false, true] {
                let mut operation = label_operation(&lab, &["m1a"], None, true, label, add);
                if matches!(turn, Turn::NoLabels)
                    && let GmailOpsOperation::ModifyMessageLabels(payload) = &mut operation
                {
                    payload.labels_to_add.clear();
                    payload.labels_to_remove.clear();
                }
                script(&lab, "POST", "messages/m1a/modify", rejection(400));
                let message = delivery(&lab, operation);
                lab.worker_step(
                    if add {
                        "legacy add rejected"
                    } else {
                        "legacy remove rejected"
                    },
                    queue,
                    &message,
                )
                .await
                .result
                .expect("legacy rejection");
                lab.reset_admission().await;
            }
            if matches!(turn, Turn::NoLabels) {
                mark(&mut lab, &["m1a"], WRITE, true, "Label_work").await;
                let mut operation =
                    label_operation(&lab, &["m1a"], Some(WRITE), true, "Label_work", true);
                if let GmailOpsOperation::ModifyMessageLabels(payload) = &mut operation {
                    payload.labels_to_add.clear();
                    payload.labels_to_remove.clear();
                }
                let message = delivery(&lab, operation);
                lab.worker_step("marked payload without labels", queue, &message)
                    .await
                    .result
                    .expect("missing turn defaults to superseded");
            }
        }
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn newest_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "newest_primary", 61000, false, Turn::Newest).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn newest_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "newest_retry", 61003, true, Turn::Newest).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn superseded_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "superseded_primary", 61006, false, Turn::Superseded).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn superseded_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "superseded_retry", 61009, true, Turn::Superseded).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn expired_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "expired_primary", 61012, false, Turn::Expired).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn expired_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "expired_retry", 61015, true, Turn::Expired).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn waiting_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "waiting_primary", 61018, false, Turn::Waiting).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn waiting_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "waiting_retry", 61021, true, Turn::Waiting).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn waiting_queue_failure_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "waiting_queue_failure_primary",
        61024,
        false,
        Turn::WaitingQueueFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn waiting_queue_failure_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "waiting_queue_failure_retry",
        61027,
        true,
        Turn::WaitingQueueFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn partial_revert_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "partial_revert_primary",
        61030,
        false,
        Turn::PartialRevert,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn partial_revert_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "partial_revert_retry",
        61033,
        true,
        Turn::PartialRevert,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_revert_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "batch_revert_primary",
        61036,
        false,
        Turn::BatchRevert,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_revert_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "batch_revert_retry", 61039, true, Turn::BatchRevert).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn newer_during_send_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "newer_during_send_primary",
        61042,
        false,
        Turn::NewerDuringSend,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn newer_during_send_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "newer_during_send_retry",
        61045,
        true,
        Turn::NewerDuringSend,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn superseded_during_send_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "superseded_during_send_primary",
        61048,
        false,
        Turn::SupersededDuringSend,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn superseded_during_send_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "superseded_during_send_retry",
        61051,
        true,
        Turn::SupersededDuringSend,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn nine_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "nine_primary", 61054, false, Turn::Nine).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn nine_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "nine_retry", 61057, true, Turn::Nine).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn ten_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "ten_primary", 61060, false, Turn::Ten).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn ten_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "ten_retry", 61063, true, Turn::Ten).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn maximum_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "maximum_primary", 61066, false, Turn::Maximum).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn maximum_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "maximum_retry", 61069, true, Turn::Maximum).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn empty_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "empty_primary", 61072, false, Turn::Empty).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn empty_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "empty_retry", 61075, true, Turn::Empty).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn no_labels_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "no_labels_primary", 61078, false, Turn::NoLabels).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn no_labels_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "no_labels_retry", 61081, true, Turn::NoLabels).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn legacy_unread_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "legacy_unread_primary",
        61084,
        false,
        Turn::LegacyUnread,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn legacy_unread_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(pool, "legacy_unread_retry", 61087, true, Turn::LegacyUnread).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn legacy_starred_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "legacy_starred_primary",
        61090,
        false,
        Turn::LegacyStarred,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn legacy_starred_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    turns(
        pool,
        "legacy_starred_retry",
        61093,
        true,
        Turn::LegacyStarred,
    )
    .await;
}
