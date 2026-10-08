use super::*;
use crate::domain::models::ImportSource;
use macro_user_id::cowlike::CowLike;
use std::sync::atomic::{AtomicUsize, Ordering};

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{email}"))
        .unwrap()
        .into_owned()
}

fn throttled(retry_after: Option<Duration>) -> ApiSourceError {
    ApiSourceError::RateLimited {
        app: ImportSource::Notion,
        retry_after,
    }
}

#[tokio::test(start_paused = true)]
async fn a_throttled_read_waits_out_retry_after_then_retries_once() {
    let calls = AtomicUsize::new(0);
    let started = Instant::now();
    let read = retry_rate_limited(|| async {
        match calls.fetch_add(1, Ordering::SeqCst) {
            0 => Err(throttled(Some(Duration::from_secs(7)))),
            _ => Ok("read"),
        }
    })
    .await;
    assert_eq!(read.unwrap(), "read");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert!(started.elapsed() >= Duration::from_secs(7));

    // A second refusal is the caller's to report.
    let calls = AtomicUsize::new(0);
    let read: Result<(), _> = retry_rate_limited(|| async {
        calls.fetch_add(1, Ordering::SeqCst);
        Err(throttled(None))
    })
    .await;
    assert!(matches!(read, Err(ApiSourceError::RateLimited { .. })));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn other_failures_are_not_retried() {
    let calls = AtomicUsize::new(0);
    let read: Result<(), _> = retry_rate_limited(|| async {
        calls.fetch_add(1, Ordering::SeqCst);
        Err(ApiSourceError::NotFound)
    })
    .await;
    assert!(matches!(read, Err(ApiSourceError::NotFound)));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn one_users_reads_are_spaced_across_readers() {
    let pacers = UserPacers::new(Duration::from_millis(300));
    let first = pacers.pacer(&user("a@example.com"));
    let second = pacers.pacer(&user("a@example.com"));
    let started = Instant::now();
    first.wait_turn().await;
    second.wait_turn().await;
    first.wait_turn().await;
    assert!(started.elapsed() >= Duration::from_millis(600));

    // Another user has their own schedule.
    let other = Instant::now();
    pacers.pacer(&user("b@example.com")).wait_turn().await;
    assert_eq!(other.elapsed(), Duration::ZERO);
}
