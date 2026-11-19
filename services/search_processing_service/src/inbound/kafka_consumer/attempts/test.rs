use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};

use anyhow::Context as _;
use opensearch_client::error::{OpensearchOperation, WriteRefusal};

use super::*;

fn refused_items() -> OpensearchClientError {
    OpensearchClientError::BulkItemsFailed {
        failed: 2,
        total: 3,
        refusal: Some(WriteRefusal::TooManyRequests),
        errors: vec!["rejected_execution_exception: rejected execution".to_owned()],
        operation: OpensearchOperation::BulkUpsertEmailMessages,
    }
}

fn retrying() -> Attempts {
    Attempts::Retry {
        stopping: CancellationToken::new(),
    }
}

/// An attempt that fails with `error()` for its first `failures` runs.
fn failing(
    failures: u32,
    error: impl Fn() -> anyhow::Error,
) -> (
    Arc<AtomicU32>,
    impl FnMut(u32) -> std::future::Ready<anyhow::Result<()>>,
) {
    let runs = Arc::new(AtomicU32::new(0));
    let counted = Arc::clone(&runs);
    let attempt = move |_| {
        let run = counted.fetch_add(1, Ordering::SeqCst) + 1;
        std::future::ready(if run <= failures {
            Err(error())
        } else {
            Ok(())
        })
    };
    (runs, attempt)
}

#[test]
fn errors_keep_the_three_attempt_schedule() {
    for failure in [Failure::Error, Failure::BulkItems, Failure::SourceMissing] {
        assert_eq!(retry_delay(failure, 1), Some(Duration::from_secs(1)));
        assert_eq!(retry_delay(failure, 2), Some(Duration::from_secs(2)));
        assert_eq!(retry_delay(failure, MAX_PROCESSING_ATTEMPTS), None);
    }
}

#[test]
fn refused_writes_wait_a_bounded_jittered_delay() {
    for attempt in 1..OVERLOADED_MAX_ATTEMPTS {
        let ceiling = Duration::from_secs(1 << (attempt - 1)).min(OVERLOADED_MAX_DELAY);
        for _ in 0..50 {
            let delay = retry_delay(Failure::Overloaded, attempt).expect("another attempt");
            assert!(
                delay >= ceiling / 2 && delay <= ceiling,
                "attempt {attempt}: {delay:?} outside {:?}..={ceiling:?}",
                ceiling / 2
            );
        }
    }
    assert_eq!(
        retry_delay(Failure::Overloaded, OVERLOADED_MAX_ATTEMPTS),
        None
    );
}

#[tokio::test(start_paused = true)]
async fn a_refused_event_keeps_trying_until_opensearch_accepts_it() {
    let (runs, attempt) = failing(OVERLOADED_MAX_ATTEMPTS - 1, || refused_items().into());
    let started = tokio::time::Instant::now();

    let attempted = retrying().run(attempt).await;

    assert_eq!(
        attempted.expect("the last attempt succeeds"),
        (Handled::Indexed, OVERLOADED_MAX_ATTEMPTS)
    );
    assert_eq!(runs.load(Ordering::SeqCst), OVERLOADED_MAX_ATTEMPTS);
    let waited = started.elapsed();
    assert!(
        waited >= Duration::from_millis(45_500) && waited <= Duration::from_secs(91),
        "{waited:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_refused_event_stops_after_its_bounded_attempts() {
    let (runs, attempt) = failing(u32::MAX, || refused_items().into());

    let exhausted = retrying().run(attempt).await.expect_err("never accepted");

    assert_eq!(runs.load(Ordering::SeqCst), OVERLOADED_MAX_ATTEMPTS);
    assert_eq!(exhausted.attempts, OVERLOADED_MAX_ATTEMPTS);
    assert_eq!(
        exhausted.diagnosis,
        Diagnosis {
            failure: Failure::Overloaded,
            failed_items: 2,
        }
    );
    assert!(
        exhausted.error.contains("rejected_execution_exception"),
        "{}",
        exhausted.error
    );
}

#[tokio::test(start_paused = true)]
async fn another_error_stops_after_three_attempts() {
    let (runs, attempt) = failing(u32::MAX, || anyhow::anyhow!("database unavailable"));

    let exhausted = retrying().run(attempt).await.expect_err("never succeeds");

    assert_eq!(runs.load(Ordering::SeqCst), MAX_PROCESSING_ATTEMPTS);
    assert_eq!(exhausted.diagnosis.failure, Failure::Error);
}

#[tokio::test(start_paused = true)]
async fn a_replay_is_attempted_once() {
    let (runs, attempt) = failing(u32::MAX, || refused_items().into());

    let exhausted = Attempts::Once.run(attempt).await.expect_err("one failure");

    assert_eq!(runs.load(Ordering::SeqCst), 1);
    assert_eq!(exhausted.attempts, 1);
}

#[tokio::test(start_paused = true)]
async fn a_stopping_consumer_ends_the_wait_for_the_next_attempt() {
    let stopping = CancellationToken::new();
    let attempts = Attempts::Retry {
        stopping: stopping.clone(),
    };
    let (runs, attempt) = failing(u32::MAX, || refused_items().into());
    let started = tokio::time::Instant::now();

    let (attempted, ()) = tokio::join!(attempts.run(attempt), async {
        tokio::time::sleep(Duration::from_millis(1_200)).await;
        stopping.cancel();
    });

    let exhausted = attempted.expect_err("cut off by the stop");
    // The first wait is at most a second, the second at least one.
    assert_eq!(runs.load(Ordering::SeqCst), 2);
    assert_eq!(exhausted.attempts, 2);
    assert_eq!(started.elapsed(), Duration::from_millis(1_200));
}

#[test]
fn errors_are_diagnosed_through_their_causes() {
    let diagnose = |error: anyhow::Error| error.diagnose();

    assert_eq!(
        diagnose(anyhow::Error::from(refused_items()).context("failed to reindex thread")),
        Diagnosis {
            failure: Failure::Overloaded,
            failed_items: 2,
        }
    );
    assert_eq!(
        diagnose(
            OpensearchClientError::BulkItemsFailed {
                failed: 1,
                total: 4,
                refusal: None,
                errors: vec![],
                operation: OpensearchOperation::BulkUpsertCallRecordSegments,
            }
            .into()
        ),
        Diagnosis {
            failure: Failure::BulkItems,
            failed_items: 1,
        }
    );
    assert_eq!(
        diagnose(
            OpensearchClientError::Unknown {
                details: r#"{"error":{"type":"rejected_execution_exception"},"status":429}"#
                    .to_owned(),
                operation: OpensearchOperation::UpsertChatMessageChild,
            }
            .into()
        )
        .failure,
        Failure::Overloaded
    );
    assert_eq!(
        diagnose(
            Err::<(), _>(sqlx::Error::RowNotFound)
                .context("unable to get channel message")
                .unwrap_err()
        )
        .failure,
        Failure::SourceMissing
    );
    assert_eq!(
        diagnose(anyhow::anyhow!("timed out")),
        Diagnosis {
            failure: Failure::Error,
            failed_items: 0,
        }
    );
}

#[test]
fn reports_are_diagnosed_through_their_contexts() {
    let report = rootcause::prelude::ResultExt::context(
        Err::<(), _>(refused_items()),
        "reconcile agent session",
    )
    .unwrap_err()
    .into_dynamic();

    assert_eq!(report.diagnose().failure, Failure::Overloaded);
    assert_eq!(
        rootcause::report!("lease lost")
            .into_dynamic()
            .diagnose()
            .failure,
        Failure::Error
    );
}

#[tokio::test(start_paused = true)]
async fn a_source_gone_for_good_ends_without_retrying() {
    let runs = Arc::new(AtomicU32::new(0));
    let counted = Arc::clone(&runs);

    let attempted = retrying()
        .run_handled(|_| {
            counted.fetch_add(1, Ordering::SeqCst);
            std::future::ready(Ok::<_, anyhow::Error>(Handled::SourceMissing))
        })
        .await;

    assert_eq!(attempted.unwrap(), (Handled::SourceMissing, 1));
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}
