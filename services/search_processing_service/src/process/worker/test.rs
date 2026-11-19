use std::sync::{Arc, Mutex};

use super::*;

/// Records each visibility change, as seconds hidden from when it was made.
#[derive(Clone, Default)]
struct RecordedVisibility(Arc<Mutex<Vec<(Duration, i32)>>>);

impl RecordedVisibility {
    fn calls(&self) -> Vec<(Duration, i32)> {
        self.0.lock().unwrap().clone()
    }
}

struct FakeMessage {
    started: tokio::time::Instant,
    calls: RecordedVisibility,
}

impl MessageVisibility for FakeMessage {
    fn hide_for(&self, seconds: i32) -> impl Future<Output = anyhow::Result<()>> + Send {
        self.calls
            .0
            .lock()
            .unwrap()
            .push((self.started.elapsed(), seconds));
        async { Ok(()) }
    }
}

fn message() -> (FakeMessage, RecordedVisibility) {
    let calls = RecordedVisibility::default();
    (
        FakeMessage {
            started: tokio::time::Instant::now(),
            calls: calls.clone(),
        },
        calls,
    )
}

#[tokio::test(start_paused = true)]
async fn quick_work_leaves_the_visibility_alone() {
    let (message, calls) = message();

    let outcome = supervise(
        async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            "indexed"
        },
        &message,
        &CancellationToken::new(),
    )
    .await;

    assert_eq!(outcome, Supervised::Finished("indexed"));
    assert!(calls.calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn long_work_keeps_its_message_hidden() {
    let (message, calls) = message();

    let outcome = supervise(
        async { tokio::time::sleep(Duration::from_secs(100)).await },
        &message,
        &CancellationToken::new(),
    )
    .await;

    assert_eq!(outcome, Supervised::Finished(()));
    assert_eq!(
        calls.calls(),
        [30, 60, 90].map(|at| (Duration::from_secs(at), VISIBILITY_EXTENSION_SECONDS)),
        "hidden again well before the queue's 120 s would let it go"
    );
}

#[tokio::test(start_paused = true)]
async fn work_still_running_after_a_stop_hands_its_message_back() {
    let (message, calls) = message();
    let stop = CancellationToken::new();
    let stopper = stop.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        stopper.cancel();
    });

    let outcome = supervise(std::future::pending::<()>(), &message, &stop).await;

    assert_eq!(outcome, Supervised::Released);
    assert_eq!(calls.calls(), [(Duration::from_secs(1) + DRAIN_GRACE, 0)]);
}

#[tokio::test(start_paused = true)]
async fn work_that_finishes_within_the_grace_is_not_handed_back() {
    let (message, calls) = message();
    let stop = CancellationToken::new();
    stop.cancel();

    let outcome = supervise(
        async { tokio::time::sleep(DRAIN_GRACE / 2).await },
        &message,
        &stop,
    )
    .await;

    assert_eq!(outcome, Supervised::Finished(()));
    assert!(calls.calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn work_past_the_processing_timeout_is_abandoned() {
    let (message, _) = message();

    let outcome = supervise(
        std::future::pending::<()>(),
        &message,
        &CancellationToken::new(),
    )
    .await;

    assert_eq!(outcome, Supervised::TimedOut);
}

/// Answers each visibility change only after `delay`.
struct SlowMessage {
    delay: Duration,
}

impl MessageVisibility for SlowMessage {
    fn hide_for(&self, _seconds: i32) -> impl Future<Output = anyhow::Result<()>> + Send {
        let delay = self.delay;
        async move {
            tokio::time::sleep(delay).await;
            Ok(())
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_stalled_visibility_change_does_not_hold_a_stop_up() {
    let stop = CancellationToken::new();
    stop.cancel();
    let started = tokio::time::Instant::now();

    let outcome = supervise(
        std::future::pending::<()>(),
        &SlowMessage {
            delay: Duration::from_secs(600),
        },
        &stop,
    )
    .await;

    assert_eq!(outcome, Supervised::Released);
    assert_eq!(started.elapsed(), DRAIN_GRACE + VISIBILITY_CALL_TIMEOUT);
}
