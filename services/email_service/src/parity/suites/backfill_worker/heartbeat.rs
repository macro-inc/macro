use super::*;
use crate::parity::lab::worker::clock::PausedClock;
use crate::pubsub::label_write_sim::fake_gmail::PauseAt;
use std::time::Duration;

async fn heartbeat(pool: PgPool, name: &'static str, shard: u32, fail: bool, receipt: bool) {
    let mut lab = start(pool, name, shard).await;
    persistent(&lab, "messages/heartbeat", 404, rejection(404));
    lab.sqs.lock().fail_visibility = fail;
    let pause = lab.gmail.pause_next_http(
        "/gmail/v1/users/me/messages/heartbeat",
        PauseAt::BeforeApply,
    );
    let first = receipt.then(|| lab.sqs.observe_visibility());
    let second = receipt.then(|| lab.sqs.observe_visibility());
    let clock = PausedClock::start().await;
    let mut message = delivery(
        &lab,
        "seed_sent_contact",
        json!({"message_provider_id":"heartbeat"}),
        1,
    );
    if !receipt {
        message.receipt_handle = None;
    }
    let control = async {
        pause.arrived.await.expect("provider pending");
        clock.advance(Duration::from_millis(20_001)).await;
        if let Some(first) = first {
            first.await.expect("first visibility recorded");
        }
        clock.advance(Duration::from_millis(20_001)).await;
        if let Some(second) = second {
            second.await.expect("second visibility recorded");
        }
        pause.release.send(()).expect("provider release");
    };
    let (result, ()) = tokio::join!(step(&mut lab, "held provider request", &message), control);
    result
        .result
        .expect("heartbeat does not change disposition");
    drop(clock);
    lab.transcript.finish();
}

async fn run_clock(pool: PgPool, name: &'static str, shard: u32, fail: bool, receipt: bool) {
    tokio::task::spawn_blocking(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("clock runtime")
            .block_on(heartbeat(pool, name, shard, fail, receipt));
    })
    .await
    .expect("clock scenario");
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn heartbeat_twice(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run_clock(pool, "heartbeat_twice", 72000, false, true).await;
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn heartbeat_failure_continues(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run_clock(pool, "heartbeat_failure_continues", 72003, true, true).await;
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn heartbeat_without_receipt(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run_clock(pool, "heartbeat_without_receipt", 72006, false, false).await;
}
