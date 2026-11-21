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

/// Records each visibility change like [`FakeMessage`], but never answers a
/// heartbeat; a release answers at once.
struct StalledHeartbeat(FakeMessage);

impl MessageVisibility for StalledHeartbeat {
    fn hide_for(&self, seconds: i32) -> impl Future<Output = anyhow::Result<()>> + Send {
        let answer = self.0.hide_for(seconds);
        async move {
            if seconds > 0 {
                std::future::pending::<()>().await;
            }
            answer.await
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_stop_during_a_stalled_heartbeat_hands_the_message_back_on_time() {
    let (message, calls) = message();
    let stop = CancellationToken::new();
    let stopper = stop.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(31)).await;
        stopper.cancel();
    });

    let outcome = supervise(
        std::future::pending::<()>(),
        &StalledHeartbeat(message),
        &stop,
    )
    .await;

    assert_eq!(outcome, Supervised::Released);
    assert_eq!(
        calls.calls(),
        [
            (VISIBILITY_HEARTBEAT, VISIBILITY_EXTENSION_SECONDS),
            (Duration::from_secs(31) + DRAIN_GRACE, 0),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn work_that_finishes_during_a_stalled_heartbeat_returns_at_once() {
    let (message, _) = message();
    let started = tokio::time::Instant::now();

    let outcome = supervise(
        async { tokio::time::sleep(Duration::from_secs(31)).await },
        &StalledHeartbeat(message),
        &CancellationToken::new(),
    )
    .await;

    assert_eq!(outcome, Supervised::Finished(()));
    assert_eq!(started.elapsed(), Duration::from_secs(31));
}

#[tokio::test(start_paused = true)]
async fn a_batch_received_at_a_stop_is_handed_back_together() {
    let batch: Vec<_> = (0..10)
        .map(|_| SlowMessage {
            delay: Duration::from_secs(2),
        })
        .collect();
    let started = tokio::time::Instant::now();

    release_all(&batch).await;

    assert_eq!(started.elapsed(), Duration::from_secs(2));
}

fn stop_after(after: Duration) -> CancellationToken {
    let stop = CancellationToken::new();
    let stopper = stop.clone();
    tokio::spawn(async move {
        tokio::time::sleep(after).await;
        stopper.cancel();
    });
    stop
}

#[tokio::test(start_paused = true)]
async fn a_receive_unanswered_after_a_stop_is_given_up_inside_the_stop_timeout() {
    let stop = stop_after(Duration::from_secs(1));
    let started = tokio::time::Instant::now();

    let received = await_receive(std::future::pending::<()>(), &stop).await;

    assert_eq!(received, Receive::Stopped);
    assert_eq!(
        started.elapsed(),
        Duration::from_secs(1) + STOPPED_RECEIVE_GRACE
    );
}

#[tokio::test(start_paused = true)]
async fn a_receive_answered_soon_after_a_stop_keeps_what_it_brought() {
    let stop = stop_after(Duration::from_secs(1));

    let received = await_receive(
        async {
            tokio::time::sleep(Duration::from_secs(3)).await;
            "messages"
        },
        &stop,
    )
    .await;

    assert_eq!(received, Receive::Answered("messages"));
}

#[tokio::test(start_paused = true)]
async fn a_receive_without_a_stop_runs_to_its_deadline() {
    let started = tokio::time::Instant::now();

    let received = await_receive(std::future::pending::<()>(), &CancellationToken::new()).await;

    assert_eq!(received, Receive::TimedOut);
    assert_eq!(started.elapsed(), ADMITTED_RECEIVE_DEADLINE);
}

#[tokio::test(start_paused = true)]
async fn no_heartbeat_is_sent_after_a_stop() {
    let (message, calls) = message();
    let stop = stop_after(Duration::from_secs(28));

    let outcome = supervise(
        async { tokio::time::sleep(Duration::from_secs(32)).await },
        &message,
        &stop,
    )
    .await;

    assert_eq!(outcome, Supervised::Finished(()));
    assert!(
        calls.calls().is_empty(),
        "a heartbeat after the stop could land after the hand-back: {:?}",
        calls.calls()
    );
}
