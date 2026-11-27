use std::{collections::VecDeque, sync::Mutex};

use super::*;
use crate::domain::models::BackfillError;

/// Long enough that work the gate holds back would fail the test; paused
/// time makes the wait instant.
const HELD_BACK: Duration = Duration::from_secs(60);

#[tokio::test(start_paused = true)]
async fn the_cap_holds_back_work_until_admitted_work_finishes() {
    let gate = BackfillGate::open(2);
    let first = gate.admit().await;
    let _second = gate.admit().await;

    assert!(
        tokio::time::timeout(HELD_BACK, gate.admit()).await.is_err(),
        "a third unit waits for the cap"
    );
    drop(first);
    let _third = tokio::time::timeout(HELD_BACK, gate.admit())
        .await
        .expect("a finished unit frees its share");
}

#[tokio::test(start_paused = true)]
async fn a_batch_takes_what_is_free_and_gives_back_one_unit_at_a_time() {
    let gate = BackfillGate::open(3);
    let _held = gate.admit().await;

    let mut batch = tokio::time::timeout(HELD_BACK, gate.admit_up_to(10))
        .await
        .expect("a batch waits only for its first unit");
    assert_eq!(batch.units(), 2);
    assert!(tokio::time::timeout(HELD_BACK, gate.admit()).await.is_err());

    let one = batch.take_one().expect("a unit to split off");
    assert_eq!((one.units(), batch.units()), (1, 1));
    drop(one);
    let _freed = tokio::time::timeout(HELD_BACK, gate.admit())
        .await
        .expect("a unit given back is free again");
}

#[tokio::test(start_paused = true)]
async fn a_batch_waits_for_one_unit_not_for_the_whole_batch() {
    let gate = BackfillGate::open(2);
    let first = gate.admit().await;
    let _second = gate.admit().await;
    let batch = tokio::spawn({
        let gate = gate.clone();
        async move { gate.admit_up_to(10).await }
    });
    tokio::time::sleep(Duration::from_millis(1)).await;

    drop(first);
    let batch = tokio::time::timeout(HELD_BACK, batch)
        .await
        .expect("one free unit admits a waiting batch")
        .expect("admitted");

    assert_eq!(batch.units(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_pause_holds_back_new_work_until_resumed() {
    let (pause, paused) = watch::channel(true);
    let gate = BackfillGate::new(5, paused);

    assert!(gate.is_paused());
    assert!(tokio::time::timeout(HELD_BACK, gate.admit()).await.is_err());
    pause.send_replace(false);
    let _work = tokio::time::timeout(HELD_BACK, gate.admit())
        .await
        .expect("resumed backfills are admitted");
}

#[tokio::test(start_paused = true)]
async fn a_pause_that_arrives_while_work_waits_for_the_cap_holds_it_too() {
    let (pause, paused) = watch::channel(false);
    let gate = BackfillGate::new(1, paused);
    let running = gate.admit().await;
    let waiting = tokio::spawn({
        let gate = gate.clone();
        async move { gate.admit().await }
    });
    tokio::time::sleep(Duration::from_millis(1)).await;

    pause.send_replace(true);
    drop(running);
    tokio::time::sleep(HELD_BACK).await;
    assert!(
        !waiting.is_finished(),
        "a pause holds work freed by the cap"
    );

    pause.send_replace(false);
    let _admitted = tokio::time::timeout(HELD_BACK, waiting)
        .await
        .expect("resumed")
        .expect("admitted");
}

/// Answers each read from a script, then repeats its last answer.
struct ScriptedControl(Mutex<VecDeque<Result<bool, &'static str>>>);

impl BackfillControl for ScriptedControl {
    async fn paused(&self) -> Result<bool, BackfillError> {
        let mut script = self.0.lock().unwrap();
        let answer = if script.len() > 1 {
            script.pop_front()
        } else {
            script.front().cloned()
        };
        answer
            .unwrap_or(Ok(false))
            .map_err(|error| BackfillError::Control(anyhow::anyhow!(error)))
    }

    async fn set_paused(&self, _: bool) -> Result<(), BackfillError> {
        Ok(())
    }
}

#[tokio::test(start_paused = true)]
async fn the_watcher_follows_the_switch_and_keeps_the_last_state_on_a_failed_read() {
    let control = ScriptedControl(Mutex::new(VecDeque::from([
        Ok(true),
        Err("table unreachable"),
        Ok(false),
    ])));
    let (pause, mut paused) = watch::channel(false);
    let stop = CancellationToken::new();
    let watcher = tokio::spawn(watch_pause(
        control,
        pause,
        PAUSE_POLL_INTERVAL,
        stop.clone(),
    ));

    paused.changed().await.unwrap();
    assert!(
        *paused.borrow_and_update(),
        "the switch is read every interval"
    );
    tokio::time::sleep(PAUSE_POLL_INTERVAL + Duration::from_millis(1)).await;
    assert!(*paused.borrow(), "a failed read keeps the switch paused");
    paused.changed().await.unwrap();
    assert!(!*paused.borrow_and_update(), "the next read resumes");

    stop.cancel();
    watcher.await.unwrap();
}

/// Hangs on the reads its script marks `None`, answers the others.
struct StallingControl(Mutex<VecDeque<Option<bool>>>);

impl BackfillControl for StallingControl {
    async fn paused(&self) -> Result<bool, BackfillError> {
        let answer = self.0.lock().unwrap().pop_front().flatten();
        match answer {
            Some(paused) => Ok(paused),
            None => std::future::pending().await,
        }
    }

    async fn set_paused(&self, _: bool) -> Result<(), BackfillError> {
        Ok(())
    }
}

#[tokio::test(start_paused = true)]
async fn a_stalled_read_gives_way_to_the_next_one() {
    let control = StallingControl(Mutex::new(VecDeque::from([None, Some(true)])));
    let (pause, mut paused) = watch::channel(false);
    let stop = CancellationToken::new();
    let watcher = tokio::spawn(watch_pause(
        control,
        pause,
        PAUSE_POLL_INTERVAL,
        stop.clone(),
    ));

    tokio::time::timeout(
        PAUSE_POLL_INTERVAL * 2 + PAUSE_READ_TIMEOUT + Duration::from_millis(1),
        paused.changed(),
    )
    .await
    .expect("the read after a stalled one applies the switch")
    .unwrap();
    assert!(*paused.borrow());

    stop.cancel();
    watcher.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_stop_ends_the_watcher_during_a_read() {
    let control = StallingControl(Mutex::new(VecDeque::from([None])));
    let (pause, _paused) = watch::channel(false);
    let stop = CancellationToken::new();
    let watcher = tokio::spawn(watch_pause(
        control,
        pause,
        PAUSE_POLL_INTERVAL,
        stop.clone(),
    ));
    tokio::time::sleep(PAUSE_POLL_INTERVAL + Duration::from_secs(1)).await;

    stop.cancel();
    tokio::time::timeout(Duration::from_millis(1), watcher)
        .await
        .expect("a stop does not wait for the read")
        .unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_switch_closed_while_paused_holds_work_back_without_spinning() {
    let (pause, paused) = watch::channel(true);
    let gate = BackfillGate::new(2, paused);
    drop(pause);

    assert!(
        tokio::time::timeout(HELD_BACK, gate.wait_unpaused())
            .await
            .is_err()
    );
    assert!(tokio::time::timeout(HELD_BACK, gate.admit()).await.is_err());
}

#[tokio::test(start_paused = true)]
async fn a_task_starts_with_the_switch_or_unpaused_when_it_cannot_read_it() {
    let paused = ScriptedControl(Mutex::new(VecDeque::from([Ok(true)])));
    let unreadable = ScriptedControl(Mutex::new(VecDeque::from([Err("table unreachable")])));

    assert!(read_pause(&paused, Duration::from_secs(5)).await);
    assert!(!read_pause(&unreadable, Duration::from_secs(5)).await);
}
