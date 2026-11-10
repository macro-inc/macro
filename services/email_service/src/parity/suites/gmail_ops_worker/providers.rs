use super::*;

#[derive(Clone, Copy)]
enum Operation {
    Single,
    SmallBatch,
    Batch,
    Delete,
    Block,
    Unblock,
}

impl Operation {
    fn message(self, lab: &Lab) -> Delivery {
        delivery(
            lab,
            match self {
                Self::Single => label_operation(lab, &["m1a"], None, true, "Label_work", true),
                Self::SmallBatch => {
                    label_operation(lab, &["m1a", "m1b"], None, false, "Label_work", true)
                }
                Self::Batch => label_operation(
                    lab,
                    &[
                        "m1a", "m1b", "m1c", "m2a", "m2b", "m3a", "worker-6", "worker-7",
                        "worker-8", "worker-9",
                    ],
                    None,
                    false,
                    "Label_work",
                    true,
                ),
                Self::Delete => GmailOpsOperation::DeleteLabel(DeleteLabelPayload {
                    provider_label_id: "Label_work".into(),
                }),
                Self::Block => GmailOpsOperation::BlockSender(BlockSenderPayload {
                    email_address: "sender@example.com".into(),
                }),
                Self::Unblock => GmailOpsOperation::UnblockSender(UnblockSenderPayload {
                    email_address: "sender@example.com".into(),
                }),
            },
        )
    }

    fn reply(self, lab: &Lab, reply: HttpReply) {
        match self {
            Self::Single | Self::SmallBatch => script(lab, "POST", "messages/m1a/modify", reply),
            Self::Batch => script(lab, "POST", "messages/batchModify", reply),
            Self::Delete => script(lab, "DELETE", "labels/Label_work", reply),
            Self::Block => {
                script(
                    lab,
                    "GET",
                    "settings/filters",
                    HttpReply::Status(200, json!({"filter":[]})),
                );
                let reply = match reply {
                    HttpReply::Status(200, _) => HttpReply::Status(
                        200,
                        json!({"id":"blocked","criteria":{"from":"sender@example.com"},"action":{"addLabelIds":["TRASH"]}}),
                    ),
                    other => other,
                };
                script(lab, "POST", "settings/filters", reply);
            }
            Self::Unblock => {
                script(
                    lab,
                    "GET",
                    "settings/filters",
                    HttpReply::Status(
                        200,
                        json!({"filter":[{"id":"blocked","criteria":{"from":"sender@example.com"},"action":{"addLabelIds":["TRASH"],"removeLabelIds":["INBOX"]}}]}),
                    ),
                );
                script(lab, "DELETE", "settings/filters/blocked", reply);
            }
        }
    }
}

fn responses() -> Vec<(&'static str, HttpReply)> {
    [
        ("success", HttpReply::Status(200, json!({}))),
        ("bad request", rejection(400)),
        ("unauthorized", rejection(401)),
        ("forbidden", rejection(403)),
        ("not found", rejection(404)),
        ("conflict", rejection(409)),
        (
            "quota limited",
            HttpReply::Status(
                429,
                json!({"error":{"code":429,"message":"Quota exceeded"}}),
            ),
        ),
        (
            "concurrency limited",
            HttpReply::Status(
                429,
                json!({"error":{"code":429,"message":"Too many concurrent requests for user."}}),
            ),
        ),
        ("internal error", rejection(500)),
        ("unavailable", rejection(503)),
        ("connection dropped", HttpReply::Disconnect),
    ]
    .into()
}

#[expect(
    clippy::disallowed_methods,
    reason = "Independent worker cases reset only their private fixture rows"
)]
async fn providers(
    pool: PgPool,
    name: &'static str,
    shard: u32,
    retry: bool,
    operation: Operation,
) {
    let mut lab = start(pool, name, shard).await;
    extend_messages(&mut lab, shard, 10).await;
    let queue = if retry {
        Queue::GmailOpsRetry
    } else {
        Queue::GmailOps
    };
    for (step, reply) in responses() {
        lab.reset_admission().await;
        lab.seed_link_token(lab.fixture.links[0]).await;
        sqlx::query("UPDATE email_links SET needs_reauth=false WHERE id=$1")
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .expect("reset token health");
        operation.reply(&lab, reply);
        let message = operation.message(&lab);
        let result = lab.worker_step(step, queue, &message).await;
        assert!(
            result.result.is_ok(),
            "{step}: worker handles provider errors"
        );
        assert!(result.sent.iter().all(|sent| sent.delay_seconds == 0));
        // A credential failure can stop before a scripted retry. The next independent case
        // supplies its own provider behavior.
        lab.gmail.lock().scripted_http.clear();
    }
    if matches!(operation, Operation::Block | Operation::Unblock) {
        for (step, reply) in responses().into_iter().skip(1) {
            lab.reset_admission().await;
            lab.seed_link_token(lab.fixture.links[0]).await;
            sqlx::query("UPDATE email_links SET needs_reauth=false WHERE id=$1")
                .bind(lab.fixture.links[0])
                .execute(&lab.db)
                .await
                .expect("reset token health");
            script(&lab, "GET", "settings/filters", reply);
            let message = operation.message(&lab);
            lab.worker_step(&format!("list filters: {step}"), queue, &message)
                .await
                .result
                .expect("filter-list error handled");
            lab.gmail.lock().scripted_http.clear();
        }
    }
    lab.reset_admission().await;
    // A full in-flight set refuses admission with a constant 1s delay, avoiding a
    // wall-clock-dependent remaining cooldown while exercising the real Redis gate.
    for index in 0..5 {
        let _: () = redis::cmd("ZADD")
            .arg(format!("gmail:{{{}}}:inflight", lab.fixture.links[0]))
            .arg(4_000_000_000_000_i64)
            .arg(format!("occupied-{index}"))
            .query_async(&mut lab.redis_connection())
            .await
            .expect("saturate admission");
    }
    let message = operation.message(&lab);
    lab.worker_step("local admission refused", queue, &message)
        .await
        .result
        .expect("handled local refusal");
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn single_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(pool, "single_primary", 60000, false, Operation::Single).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn single_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(pool, "single_retry", 60003, true, Operation::Single).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn small_batch_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(
        pool,
        "small_batch_primary",
        60006,
        false,
        Operation::SmallBatch,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn small_batch_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(
        pool,
        "small_batch_retry",
        60009,
        true,
        Operation::SmallBatch,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(pool, "batch_primary", 60012, false, Operation::Batch).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn batch_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(pool, "batch_retry", 60015, true, Operation::Batch).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_label_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(
        pool,
        "delete_label_primary",
        60018,
        false,
        Operation::Delete,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn delete_label_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(pool, "delete_label_retry", 60021, true, Operation::Delete).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn block_sender_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(pool, "block_sender_primary", 60024, false, Operation::Block).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn block_sender_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(pool, "block_sender_retry", 60027, true, Operation::Block).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn unblock_sender_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(
        pool,
        "unblock_sender_primary",
        60030,
        false,
        Operation::Unblock,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn unblock_sender_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    providers(
        pool,
        "unblock_sender_retry",
        60033,
        true,
        Operation::Unblock,
    )
    .await;
}
