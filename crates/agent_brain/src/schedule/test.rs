use std::sync::atomic::AtomicUsize;

use chrono::TimeZone as _;

use super::*;

#[test]
fn five_field_cron_is_accepted() {
    let trigger = Trigger::cron("*/30 * * * *").unwrap();
    let now = Utc.with_ymd_and_hms(2026, 11, 2, 10, 10, 0).unwrap();
    assert_eq!(
        trigger.next_cron_delay(now),
        Some(Duration::from_secs(20 * 60))
    );
}

#[test]
fn six_field_cron_and_errors() {
    let trigger = Trigger::cron("0 0 9 * * Mon-Fri").unwrap();
    // 2026-11-07 is a Saturday: next run is Monday 09:00.
    let now = Utc.with_ymd_and_hms(2026, 11, 7, 12, 0, 0).unwrap();
    assert_eq!(
        trigger.next_cron_delay(now),
        Some(Duration::from_secs((36 + 9) * 3600))
    );
    assert!(Trigger::cron("not a schedule").is_err());
    assert_eq!(
        Trigger::every(Duration::from_secs(1)).next_cron_delay(now),
        None
    );
}

fn counter() -> (
    Arc<AtomicUsize>,
    impl Fn() -> std::future::Ready<()> + Send + Sync + 'static,
) {
    let count = Arc::new(AtomicUsize::new(0));
    let job_count = Arc::clone(&count);
    (count, move || {
        job_count.fetch_add(1, Ordering::SeqCst);
        std::future::ready(())
    })
}

#[tokio::test(start_paused = true)]
async fn interval_jobs_fire_each_period_until_cancelled() {
    let cancel = CancellationToken::new();
    let (count, job) = counter();
    let handle =
        Job::new("tick", Trigger::every(Duration::from_secs(10))).spawn(cancel.clone(), job);

    tokio::time::sleep(Duration::from_secs(35)).await;
    assert_eq!(count.load(Ordering::SeqCst), 3);

    cancel.cancel();
    handle.await.unwrap();
    tokio::time::sleep(Duration::from_secs(60)).await;
    assert_eq!(count.load(Ordering::SeqCst), 3);
}

#[tokio::test(start_paused = true)]
async fn run_at_start_fires_immediately() {
    let cancel = CancellationToken::new();
    let (count, job) = counter();
    Job::new("tick", Trigger::every(Duration::from_secs(10)))
        .run_at_start(true)
        .spawn(cancel.clone(), job);

    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(count.load(Ordering::SeqCst), 1);
    cancel.cancel();
}

#[tokio::test(start_paused = true)]
async fn a_firing_during_a_slow_run_is_skipped() {
    let cancel = CancellationToken::new();
    let started = Arc::new(AtomicUsize::new(0));
    let job_started = Arc::clone(&started);
    Job::new("slow", Trigger::every(Duration::from_secs(10))).spawn(cancel.clone(), move || {
        job_started.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(15))
    });

    // Fires at 10 (runs to 25), skips 20, fires at 30 (runs to 45).
    tokio::time::sleep(Duration::from_secs(35)).await;
    assert_eq!(started.load(Ordering::SeqCst), 2);
    cancel.cancel();
}
