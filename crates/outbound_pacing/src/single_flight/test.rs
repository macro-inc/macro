use std::{
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
    time::Duration,
};

use super::SingleFlight;

fn counted(
    runs: &Arc<AtomicU32>,
    value: &'static str,
) -> impl Future<Output = &'static str> + use<> {
    let runs = Arc::clone(runs);
    async move {
        runs.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(1)).await;
        value
    }
}

#[tokio::test(start_paused = true)]
async fn concurrent_identical_work_runs_once() {
    let flights = SingleFlight::default();
    let runs = Arc::new(AtomicU32::new(0));

    let (first, second, third) = tokio::join!(
        flights.run("key", counted(&runs, "first")),
        flights.run("key", counted(&runs, "second")),
        flights.run("key", counted(&runs, "third")),
    );

    assert_eq!((first, second, third), ("first", "first", "first"));
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn different_keys_run_separately() {
    let flights = SingleFlight::default();
    let runs = Arc::new(AtomicU32::new(0));

    let (first, second) = tokio::join!(
        flights.run("one", counted(&runs, "one")),
        flights.run("two", counted(&runs, "two")),
    );

    assert_eq!((first, second), ("one", "two"));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn finished_work_is_not_kept() {
    let flights = SingleFlight::default();
    let runs = Arc::new(AtomicU32::new(0));

    let first = flights.run("key", counted(&runs, "first")).await;
    let second = flights.run("key", counted(&runs, "second")).await;

    assert_eq!((first, second), ("first", "second"));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn a_waiter_carries_on_when_the_caller_that_started_the_work_is_dropped() {
    let flights = SingleFlight::default();
    let runs = Arc::new(AtomicU32::new(0));
    let mut leader = Box::pin(flights.run("key", counted(&runs, "leader")));
    let mut follower = Box::pin(flights.run("key", counted(&runs, "follower")));

    assert!(futures::poll!(&mut leader).is_pending());
    assert!(futures::poll!(&mut follower).is_pending());
    drop(leader);

    assert_eq!(follower.await, "leader");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}
