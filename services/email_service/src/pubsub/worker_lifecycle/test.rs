use super::run_until_cancelled;
use std::future::{pending, poll_fn, ready};
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::Poll;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn pending_work_is_interrupted_by_cancellation() {
    let cancellation_token = CancellationToken::new();
    let worker_token = cancellation_token.clone();
    let worker =
        tokio::spawn(async move { run_until_cancelled(&worker_token, pending::<()>()).await });

    tokio::task::yield_now().await;
    cancellation_token.cancel();

    let result = tokio::time::timeout(Duration::from_secs(1), worker)
        .await
        .expect("worker should stop after cancellation")
        .expect("worker task should not panic");
    assert_eq!(result, None);
}

#[tokio::test]
async fn completed_work_is_returned() {
    let cancellation_token = CancellationToken::new();

    let result = run_until_cancelled(&cancellation_token, ready(42)).await;

    assert_eq!(result, Some(42));
}

#[tokio::test]
async fn already_cancelled_token_wins_over_ready_work() {
    let cancellation_token = CancellationToken::new();
    cancellation_token.cancel();
    let operation_was_polled = AtomicBool::new(false);
    let operation = poll_fn(|_| {
        operation_was_polled.store(true, Ordering::Relaxed);
        Poll::Ready(42)
    });

    let result = run_until_cancelled(&cancellation_token, operation).await;

    assert_eq!(result, None);
    assert!(!operation_was_polled.load(Ordering::Relaxed));
}
