use super::*;

async fn effects(pool: PgPool, name: &'static str, shard: u32, retry: bool, op: Op) {
    let mut lab = start(pool, name, shard).await;
    let id = if matches!(op, Op::Upsert) {
        "event-message"
    } else {
        "m1a"
    };
    provider_message(&lab, id, "t1", &["INBOX", "UNREAD", "Label_work"]);
    lab.reject_next_kafka_publish();
    let message = delivery(&lab, op, id);
    let outcome = lab
        .worker_step("broker rejects event", queue(retry), &message)
        .await;
    assert!(
        outcome.deleted,
        "best-effort Kafka failure must not retain mail"
    );
    outcome.result.expect("broker failure swallowed");
    duplicate(&mut lab, retry, &message).await;
    lab.transcript.finish();
}

cases! { effects;
    effects_upsert_primary, 87000, false, Op::Upsert;
    effects_upsert_retry, 87003, true, Op::Upsert;
    effects_labels_primary, 87006, false, Op::Labels;
    effects_labels_retry, 87009, true, Op::Labels;
    effects_delete_primary, 87012, false, Op::Delete;
    effects_delete_retry, 87015, true, Op::Delete;
}
