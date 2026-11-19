use std::{collections::VecDeque, sync::Mutex};

use super::*;
use crate::domain::models::BackfillError;

/// Long enough that work the gate holds back would fail the test; paused
/// time makes the wait instant.
const HELD_BACK: Duration = Duration::from_secs(60);

#[tokio::test(start_paused = true)]
async fn the_cap_holds_back_work_until_admitted_work_finishes() {
    let gate = BackfillGate::open(2);
    let first = gate.admit(1).await;
    let _second = gate.admit(1).await;

    assert!(
        tokio::time::timeout(HELD_BACK, gate.admit(1))
            .await
            .is_err(),
        "a third unit waits for the cap"
    );
    drop(first);
    let _third = tokio::time::timeout(HELD_BACK, gate.admit(1))
        .await
        .expect("a finished unit frees its share");
}

#[tokio::test(start_paused = true)]
async fn work_larger_than_the_cap_takes_all_of_it() {
    let gate = BackfillGate::open(3);

    let batch = tokio::time::timeout(HELD_BACK, gate.admit(10))
        .await
        .expect("a batch larger than the cap is still admitted");

    assert!(
        tokio::time::timeout(HELD_BACK, gate.admit(1))
            .await
            .is_err()
    );
    drop(batch);
    let _next = gate.admit(1).await;
}

#[tokio::test(start_paused = true)]
async fn a_pause_holds_back_new_work_until_resumed() {
    let (pause, paused) = watch::channel(true);
    let gate = BackfillGate::new(5, paused);

    assert!(gate.is_paused());
    assert!(
        tokio::time::timeout(HELD_BACK, gate.admit(1))
            .await
            .is_err()
    );
    pause.send_replace(false);
    let _work = tokio::time::timeout(HELD_BACK, gate.admit(1))
        .await
        .expect("resumed backfills are admitted");
}

#[tokio::test(start_paused = true)]
async fn a_pause_that_arrives_while_work_waits_for_the_cap_holds_it_too() {
    let (pause, paused) = watch::channel(false);
    let gate = BackfillGate::new(1, paused);
    let running = gate.admit(1).await;
    let waiting = tokio::spawn({
        let gate = gate.clone();
        async move { gate.admit(1).await }
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
        "the first read happens at once"
    );
    tokio::time::sleep(PAUSE_POLL_INTERVAL + Duration::from_millis(1)).await;
    assert!(*paused.borrow(), "a failed read keeps the switch paused");
    paused.changed().await.unwrap();
    assert!(!*paused.borrow_and_update(), "the next read resumes");

    stop.cancel();
    watcher.await.unwrap();
}
