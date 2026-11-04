use std::{
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use tokio::sync::oneshot;

use super::*;

type Classification = Pin<Box<dyn Future<Output = ()> + Send>>;

/// A classification that runs until released, counting its starts.
fn gated(starts: &Arc<AtomicUsize>) -> (Classification, oneshot::Sender<()>) {
    let (release, released) = oneshot::channel();
    let starts = Arc::clone(starts);
    let classification = Box::pin(async move {
        starts.fetch_add(1, Ordering::SeqCst);
        let _ = released.await;
    });
    (classification, release)
}

#[tokio::test]
async fn a_slow_thread_does_not_hold_up_another() {
    let mut classifications = Classifications::new(2);
    let starts = Arc::new(AtomicUsize::new(0));

    let (slow, _still_running) = gated(&starts);
    classifications.submit(Uuid::now_v7(), slow);

    let (classified, done) = oneshot::channel();
    classifications.submit(
        Uuid::now_v7(),
        Box::pin(async move {
            let _ = classified.send(());
        }) as Classification,
    );

    // The second finishes while the first is still waiting to be released.
    done.await.unwrap();
    classifications.next_finished().await;
    assert!(classifications.has_room());
    classifications.shutdown().await;
}

#[tokio::test]
async fn capacity_bounds_the_threads_running() {
    let mut classifications = Classifications::new(2);
    let starts = Arc::new(AtomicUsize::new(0));

    let (first, release_first) = gated(&starts);
    let (second, _still_running) = gated(&starts);
    classifications.submit(Uuid::now_v7(), first);
    assert!(classifications.has_room());
    classifications.submit(Uuid::now_v7(), second);
    assert!(!classifications.has_room());

    release_first.send(()).unwrap();
    classifications.next_finished().await;
    assert!(classifications.has_room());
    classifications.shutdown().await;
}

#[tokio::test]
async fn mail_during_a_run_classifies_once_more_afterwards() {
    let mut classifications = Classifications::new(1);
    let thread_id = Uuid::now_v7();
    let (first_started_tx, first_started) = oneshot::channel();
    let (release_first, first_released) = oneshot::channel::<()>();
    let (newest_ran_tx, newest_ran) = oneshot::channel();
    let superseded = Arc::new(AtomicUsize::new(0));

    classifications.submit(
        thread_id,
        Box::pin(async move {
            let _ = first_started_tx.send(());
            let _ = first_released.await;
        }) as Classification,
    );
    first_started.await.unwrap();

    let superseded_runs = Arc::clone(&superseded);
    classifications.submit(
        thread_id,
        Box::pin(async move {
            superseded_runs.fetch_add(1, Ordering::SeqCst);
        }),
    );
    classifications.submit(
        thread_id,
        Box::pin(async move {
            let _ = newest_ran_tx.send(());
        }),
    );

    // Two more events took no slot of their own.
    assert_eq!(classifications.running.len(), 1);
    release_first.send(()).unwrap();
    classifications.next_finished().await;
    newest_ran.await.unwrap();
    assert!(!classifications.has_room());
    classifications.next_finished().await;
    assert!(classifications.has_room());
    assert_eq!(superseded.load(Ordering::SeqCst), 0);
    classifications.shutdown().await;
}

#[tokio::test]
async fn shutdown_drops_what_is_running() {
    let mut classifications = Classifications::new(1);
    let (started_tx, started) = oneshot::channel();
    let (dropped_tx, dropped) = oneshot::channel::<()>();
    classifications.submit(
        Uuid::now_v7(),
        Box::pin(async move {
            let _dropped_with_the_future = dropped_tx;
            let _ = started_tx.send(());
            std::future::pending::<()>().await;
        }) as Classification,
    );
    started.await.unwrap();

    classifications.shutdown().await;

    // The sender went with the future when shutdown cancelled it.
    assert!(dropped.await.is_err());
}

fn bad_thread() {
    panic!("a bad thread");
}

#[tokio::test]
async fn a_panic_gives_its_slot_back() {
    let mut classifications = Classifications::new(1);
    classifications.submit(
        Uuid::now_v7(),
        Box::pin(async { bad_thread() }) as Classification,
    );

    classifications.next_finished().await;

    assert!(classifications.has_room());
    classifications.shutdown().await;
}
