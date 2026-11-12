use std::{
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use futures::future::join_all;
use tokio::sync::oneshot;

use super::SingleFlight;

type Caller<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Work that counts each time it starts and finishes when `release` fires.
fn counted(
    runs: &Arc<AtomicUsize>,
    release: oneshot::Receiver<Result<u32, String>>,
) -> impl Future<Output = Result<u32, String>> + Send + 'static {
    let runs = Arc::clone(runs);
    async move {
        runs.fetch_add(1, Ordering::SeqCst);
        release.await.unwrap()
    }
}

#[tokio::test]
async fn concurrent_callers_with_one_key_share_one_run() {
    let flights = SingleFlight::<&str, Result<u32, String>>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = oneshot::channel();

    let mut callers: Vec<Caller<'_, _>> =
        vec![Box::pin(flights.run("user-1", counted(&runs, released)))];
    for _ in 0..19 {
        let (_unused, never_released) = oneshot::channel();
        callers.push(Box::pin(
            flights.run("user-1", counted(&runs, never_released)),
        ));
    }
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    release.send(Ok(7)).unwrap();

    assert_eq!(join_all(callers).await, vec![Ok(7); 20]);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn different_keys_run_separately() {
    let flights = SingleFlight::<(&str, bool), Result<u32, String>>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release_first, first_released) = oneshot::channel();
    let (release_other_user, other_user_released) = oneshot::channel();
    let (release_other_filter, other_filter_released) = oneshot::channel();

    let mut callers: Vec<Caller<'_, _>> = vec![
        Box::pin(flights.run(("user-1", false), counted(&runs, first_released))),
        Box::pin(flights.run(("user-2", false), counted(&runs, other_user_released))),
        Box::pin(flights.run(("user-1", true), counted(&runs, other_filter_released))),
    ];
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    release_first.send(Ok(1)).unwrap();
    release_other_user.send(Ok(2)).unwrap();
    release_other_filter.send(Ok(3)).unwrap();

    assert_eq!(join_all(callers).await, vec![Ok(1), Ok(2), Ok(3)]);
    assert_eq!(runs.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn a_finished_run_is_not_reused() {
    let flights = SingleFlight::<&str, Result<u32, String>>::new();
    let runs = Arc::new(AtomicUsize::new(0));

    let (release, released) = oneshot::channel();
    release.send(Ok(1)).unwrap();
    assert_eq!(flights.run("user-1", counted(&runs, released)).await, Ok(1));

    let (release, released) = oneshot::channel();
    release.send(Ok(2)).unwrap();
    assert_eq!(flights.run("user-1", counted(&runs, released)).await, Ok(2));

    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn an_error_reaches_every_caller_and_the_next_caller_starts_again() {
    let flights = SingleFlight::<&str, Result<u32, String>>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = oneshot::channel();
    let (_unused, never_released) = oneshot::channel();

    let mut callers: Vec<Caller<'_, _>> = vec![
        Box::pin(flights.run("user-1", counted(&runs, released))),
        Box::pin(flights.run("user-1", counted(&runs, never_released))),
    ];
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    release.send(Err("connection lost".to_string())).unwrap();

    assert_eq!(
        join_all(callers).await,
        vec![Err("connection lost".to_string()); 2]
    );

    let (release, released) = oneshot::channel();
    release.send(Ok(5)).unwrap();
    assert_eq!(flights.run("user-1", counted(&runs, released)).await, Ok(5));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn cancelling_the_caller_that_started_the_run_leaves_the_others_waiting_on_it() {
    let flights = SingleFlight::<&str, Result<u32, String>>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = oneshot::channel();

    let mut callers: Vec<Caller<'_, _>> =
        vec![Box::pin(flights.run("user-1", counted(&runs, released)))];
    for _ in 0..2 {
        let (_unused, never_released) = oneshot::channel();
        callers.push(Box::pin(
            flights.run("user-1", counted(&runs, never_released)),
        ));
    }
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    drop(callers.remove(0));
    release.send(Ok(9)).unwrap();

    assert_eq!(join_all(callers).await, vec![Ok(9); 2]);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_run_abandoned_by_every_caller_is_dropped_and_replaced() {
    let flights = SingleFlight::<&str, Result<u32, String>>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (abandoned, released) = oneshot::channel();

    let mut callers: Vec<Caller<'_, _>> =
        vec![Box::pin(flights.run("user-1", counted(&runs, released)))];
    let (_unused, never_released) = oneshot::channel();
    callers.push(Box::pin(
        flights.run("user-1", counted(&runs, never_released)),
    ));
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    drop(callers);
    assert!(abandoned.is_closed());

    let (release, released) = oneshot::channel();
    release.send(Ok(3)).unwrap();
    assert_eq!(flights.run("user-1", counted(&runs, released)).await, Ok(3));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}
