use std::{
    panic::AssertUnwindSafe,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use futures::{
    FutureExt,
    future::{BoxFuture, join_all},
};
use tokio::sync::watch;

use super::SingleFlight;

type Output = Result<u32, String>;
type Caller<'a> = Pin<Box<dyn Future<Output = Output> + Send + 'a>>;

/// Work that counts each time it starts and finishes when `released` holds an
/// output.
fn counted(
    runs: &Arc<AtomicUsize>,
    released: &watch::Receiver<Option<Output>>,
) -> impl Fn() -> BoxFuture<'static, Output> + Send + Sync + 'static {
    let runs = Arc::clone(runs);
    let released = released.clone();

    move || {
        let runs = Arc::clone(&runs);
        let mut released = released.clone();
        Box::pin(async move {
            runs.fetch_add(1, Ordering::SeqCst);
            let output = released.wait_for(Option::is_some).await.unwrap();
            output.clone().unwrap()
        })
    }
}

#[tokio::test]
async fn concurrent_callers_with_one_key_share_one_run() {
    let flights = SingleFlight::<&str, Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = watch::channel(None);

    let mut callers: Vec<Caller<'_>> = Vec::new();
    for _ in 0..20 {
        callers.push(Box::pin(flights.run("user-1", counted(&runs, &released))));
    }
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    release.send(Some(Ok(7))).unwrap();

    assert_eq!(join_all(callers).await, vec![Ok(7); 20]);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn different_keys_run_separately() {
    let flights = SingleFlight::<(&str, bool), Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release_first, first_released) = watch::channel(None);
    let (release_other_user, other_user_released) = watch::channel(None);
    let (release_other_filter, other_filter_released) = watch::channel(None);

    let mut callers: Vec<Caller<'_>> = vec![
        Box::pin(flights.run(("user-1", false), counted(&runs, &first_released))),
        Box::pin(flights.run(("user-2", false), counted(&runs, &other_user_released))),
        Box::pin(flights.run(("user-1", true), counted(&runs, &other_filter_released))),
    ];
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    release_first.send(Some(Ok(1))).unwrap();
    release_other_user.send(Some(Ok(2))).unwrap();
    release_other_filter.send(Some(Ok(3))).unwrap();

    assert_eq!(join_all(callers).await, vec![Ok(1), Ok(2), Ok(3)]);
    assert_eq!(runs.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn a_caller_arriving_after_the_run_finished_starts_a_new_run() {
    let flights = SingleFlight::<&str, Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = watch::channel(None);
    let (_release_later, later_released) = watch::channel(Some(Ok(2)));

    let mut callers: Vec<Caller<'_>> = vec![
        Box::pin(flights.run("user-1", counted(&runs, &released))),
        Box::pin(flights.run("user-1", counted(&runs, &released))),
    ];
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    release.send(Some(Ok(1))).unwrap();

    // The first caller finishes the run. The second has not collected its
    // output yet and still holds the finished work.
    assert_eq!(callers.remove(0).await, Ok(1));

    let later = flights.run("user-1", counted(&runs, &later_released)).await;
    assert_eq!(later, Ok(2));
    assert_eq!(callers.remove(0).await, Ok(1));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn an_error_reaches_every_caller_and_the_next_caller_starts_again() {
    let flights = SingleFlight::<&str, Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = watch::channel(None);

    let mut callers: Vec<Caller<'_>> = vec![
        Box::pin(flights.run("user-1", counted(&runs, &released))),
        Box::pin(flights.run("user-1", counted(&runs, &released))),
    ];
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    release
        .send(Some(Err("connection lost".to_string())))
        .unwrap();

    assert_eq!(
        join_all(callers).await,
        vec![Err("connection lost".to_string()); 2]
    );

    release.send(Some(Ok(5))).unwrap();
    let retried = flights.run("user-1", counted(&runs, &released)).await;
    assert_eq!(retried, Ok(5));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn cancelling_the_caller_that_started_the_run_leaves_the_others_waiting_on_it() {
    let flights = SingleFlight::<&str, Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = watch::channel(None);

    let mut callers: Vec<Caller<'_>> = Vec::new();
    for _ in 0..3 {
        callers.push(Box::pin(flights.run("user-1", counted(&runs, &released))));
    }
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    drop(callers.remove(0));
    release.send(Some(Ok(9))).unwrap();

    assert_eq!(join_all(callers).await, vec![Ok(9); 2]);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_run_abandoned_by_every_caller_is_dropped_and_replaced() {
    let flights = SingleFlight::<&str, Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = watch::channel(None);

    let mut callers: Vec<Caller<'_>> = vec![
        Box::pin(flights.run("user-1", counted(&runs, &released))),
        Box::pin(flights.run("user-1", counted(&runs, &released))),
    ];
    for caller in &mut callers {
        assert!(futures::poll!(caller.as_mut()).is_pending());
    }
    // The test, both callers' work factories and the running work each hold
    // the receiver.
    assert_eq!(release.receiver_count(), 4);
    drop(callers);
    assert_eq!(release.receiver_count(), 1);

    release.send(Some(Ok(3))).unwrap();
    let replaced = flights.run("user-1", counted(&runs, &released)).await;
    assert_eq!(replaced, Ok(3));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn when_the_work_panics_the_other_callers_run_it_themselves() {
    let flights = SingleFlight::<&str, Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = watch::channel(None::<()>);
    let panics_on_first_run = || {
        let runs = Arc::clone(&runs);
        let mut released = released.clone();
        async move {
            let run = runs.fetch_add(1, Ordering::SeqCst);
            released.wait_for(Option::is_some).await.unwrap();
            assert_ne!(run, 0, "the first run panics");
            Ok(4)
        }
    };

    let mut started: Caller<'_> = Box::pin(flights.run("user-1", panics_on_first_run));
    let mut joined: Caller<'_> = Box::pin(flights.run("user-1", panics_on_first_run));
    assert!(futures::poll!(started.as_mut()).is_pending());
    assert!(futures::poll!(joined.as_mut()).is_pending());
    release.send(Some(())).unwrap();

    // The caller driving the work when it panics gets the panic.
    assert!(AssertUnwindSafe(joined).catch_unwind().await.is_err());

    assert_eq!(started.await, Ok(4));
    assert_eq!(flights.run("user-1", panics_on_first_run).await, Ok(4));
    assert_eq!(runs.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn a_run_to_completion_abandoned_by_every_caller_is_joined_by_the_next() {
    let flights = SingleFlight::<&str, Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = watch::channel(None);

    let mut abandoned: Caller<'_> =
        Box::pin(flights.run_to_completion("user-1", counted(&runs, &released)));
    assert!(futures::poll!(abandoned.as_mut()).is_pending());
    drop(abandoned);

    let mut next: Caller<'_> =
        Box::pin(flights.run_to_completion("user-1", counted(&runs, &released)));
    assert!(futures::poll!(next.as_mut()).is_pending());
    release.send(Some(Ok(5))).unwrap();

    assert_eq!(next.await, Ok(5));
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_run_to_completion_finishes_with_no_caller_left() {
    let flights = SingleFlight::<&str, Output>::new();
    let (release, released) = watch::channel(None::<()>);
    // The work holds the only sender, so work that is dropped unfinished
    // closes the channel and fails the wait below instead of hanging it.
    let (finish, mut finished) = watch::channel(false);
    let work = move || {
        let mut released = released.clone();
        let finish = finish.clone();
        async move {
            released.wait_for(Option::is_some).await.unwrap();
            finish.send(true).unwrap();
            Ok(6)
        }
    };

    let mut abandoned: Caller<'_> = Box::pin(flights.run_to_completion("user-1", work));
    assert!(futures::poll!(abandoned.as_mut()).is_pending());
    drop(abandoned);
    release.send(Some(())).unwrap();

    assert!(finished.wait_for(|done| *done).await.is_ok());
}

#[tokio::test]
async fn when_a_run_to_completion_panics_every_caller_runs_it_itself() {
    let flights = SingleFlight::<&str, Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let (release, released) = watch::channel(None::<()>);
    let panics_on_first_run = || {
        let runs = Arc::clone(&runs);
        let mut released = released.clone();
        async move {
            let run = runs.fetch_add(1, Ordering::SeqCst);
            released.wait_for(Option::is_some).await.unwrap();
            assert_ne!(run, 0, "the first run panics");
            Ok(4)
        }
    };

    let mut started: Caller<'_> =
        Box::pin(flights.run_to_completion("user-1", panics_on_first_run));
    let mut joined: Caller<'_> = Box::pin(flights.run_to_completion("user-1", panics_on_first_run));
    assert!(futures::poll!(started.as_mut()).is_pending());
    assert!(futures::poll!(joined.as_mut()).is_pending());
    release.send(Some(())).unwrap();

    // The task drives the work, so its panic reaches no caller.
    assert_eq!(joined.await, Ok(4));
    assert_eq!(started.await, Ok(4));
    assert_eq!(runs.load(Ordering::SeqCst), 3);
}

/// A caller that polled the work alongside the task could find it poisoned by
/// a panic on the task's thread. Work that panics on its first poll shows
/// whether a caller ever polls it.
#[tokio::test]
async fn a_run_to_completion_caller_never_polls_the_work() {
    let flights = SingleFlight::<&str, Output>::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let panics_on_first_poll = || {
        let runs = Arc::clone(&runs);
        async move {
            let run = runs.fetch_add(1, Ordering::SeqCst);
            assert_ne!(run, 0, "the first run panics");
            Ok(8)
        }
    };

    let mut caller: Caller<'_> =
        Box::pin(flights.run_to_completion("user-1", panics_on_first_poll));
    let polled = AssertUnwindSafe(async { futures::poll!(caller.as_mut()) })
        .catch_unwind()
        .await;
    assert!(
        polled.is_ok_and(|poll| poll.is_pending()),
        "the caller waits for the task instead of polling the work"
    );

    assert_eq!(caller.await, Ok(8));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

/// A run's guard locks the registry when dropped, so it must not exist yet
/// while the start path holds that lock and makes the work. The check runs on
/// its own thread so that a deadlock fails the test instead of hanging it.
#[test]
fn a_work_factory_that_panics_leaves_the_key_to_the_next_caller() {
    let (done, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        runtime.block_on(async {
            let flights = SingleFlight::<&str, Output>::new();
            let factory = |panics: bool| {
                move || {
                    assert!(!panics, "the work factory panics");
                    std::future::ready(Ok(1))
                }
            };

            let started = AssertUnwindSafe(flights.run("user-1", factory(true)))
                .catch_unwind()
                .await;
            assert!(started.is_err());
            assert_eq!(flights.run("user-1", factory(false)).await, Ok(1));

            let started = AssertUnwindSafe(flights.run_to_completion("user-2", factory(true)))
                .catch_unwind()
                .await;
            assert!(started.is_err());
            assert_eq!(
                flights.run_to_completion("user-2", factory(false)).await,
                Ok(1)
            );
        });
        done.send(()).unwrap();
    });

    assert!(
        finished
            .recv_timeout(std::time::Duration::from_secs(30))
            .is_ok(),
        "a panicking work factory left the registry locked or failed a check"
    );
}
