use std::sync::Mutex as StdMutex;

use chrono::Utc;
use tokio::sync::{Notify, Semaphore};

use super::*;

const COMPUTER: ComputerId = ComputerId::new_from_uuid(uuid::Uuid::from_u128(0xC0));

fn drive(seconds: i64) -> DriveId {
    DriveId::of(
        COMPUTER,
        chrono::DateTime::<Utc>::from_timestamp(seconds, 0).unwrap(),
    )
}

/// A refreeze that records each drive and waits for a permit; panics on a
/// drive it was told to.
struct Recorder {
    ran: StdMutex<Vec<DriveId>>,
    started: Notify,
    permits: Semaphore,
    panic_on: StdMutex<Option<DriveId>>,
}

fn refreezes(recorder: &Arc<Recorder>, tasks: &TaskTracker) -> Refreezes {
    let recorder = Arc::clone(recorder);
    Refreezes::new(
        Arc::new(move |_computer, drive| {
            let recorder = Arc::clone(&recorder);
            Box::pin(async move {
                recorder.ran.lock().unwrap().push(drive.clone());
                recorder.started.notify_one();
                let _permit = recorder.permits.acquire().await.unwrap();
                if recorder.panic_on.lock().unwrap().as_ref() == Some(&drive) {
                    panic!("a refreeze panicked");
                }
            })
        }),
        tasks.clone(),
    )
}

fn recorder() -> Arc<Recorder> {
    Arc::new(Recorder {
        ran: StdMutex::new(Vec::new()),
        started: Notify::new(),
        permits: Semaphore::new(0),
        panic_on: StdMutex::new(None),
    })
}

#[tokio::test]
async fn requests_while_one_runs_are_coalesced_and_run_after_it() {
    let recorder = recorder();
    let tasks = TaskTracker::new();
    let refreezes = refreezes(&recorder, &tasks);

    refreezes.request(COMPUTER, drive(1));
    recorder.started.notified().await;
    refreezes.request(COMPUTER, drive(2));
    refreezes.request(COMPUTER, drive(3));
    recorder.permits.add_permits(10);
    tasks.close();
    tasks.wait().await;

    assert_eq!(*recorder.ran.lock().unwrap(), vec![drive(1), drive(3)]);
}

#[tokio::test]
async fn a_panicking_refreeze_never_leaves_the_computer_busy() {
    let recorder = recorder();
    *recorder.panic_on.lock().unwrap() = Some(drive(1));
    recorder.permits.add_permits(10);
    let tasks = TaskTracker::new();
    let refreezes = refreezes(&recorder, &tasks);

    refreezes.request(COMPUTER, drive(1));
    let tasks_done = tasks.clone();
    tasks_done.close();
    tasks_done.wait().await;
    let tasks = TaskTracker::new();
    let refreezes = Refreezes {
        tasks: tasks.clone(),
        ..refreezes
    };
    refreezes.request(COMPUTER, drive(2));
    tasks.close();
    tasks.wait().await;

    assert_eq!(*recorder.ran.lock().unwrap(), vec![drive(1), drive(2)]);
}
