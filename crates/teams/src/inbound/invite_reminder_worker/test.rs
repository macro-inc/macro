use std::sync::Mutex;

use super::*;
use crate::domain::{
    model::TeamError,
    team_service::invite_reminders::{INVITE_REMINDER_BATCH, InviteReminderReport},
};

/// Hands out one scripted result per sweep, then empty sweeps.
struct ScriptedSweeps {
    results: Mutex<Vec<Result<usize, ()>>>,
    sweeps: Mutex<Vec<tokio::time::Instant>>,
}

impl ScriptedSweeps {
    fn new(results: Vec<Result<usize, ()>>) -> Arc<Self> {
        Arc::new(Self {
            results: Mutex::new(results),
            sweeps: Mutex::new(Vec::new()),
        })
    }

    fn sweep_times(&self) -> Vec<tokio::time::Instant> {
        self.sweeps.lock().unwrap().clone()
    }
}

impl InviteReminderSender for ScriptedSweeps {
    fn send_due_invite_reminders(
        &self,
    ) -> impl Future<Output = Result<InviteReminderReport, TeamError>> + Send {
        self.sweeps
            .lock()
            .unwrap()
            .push(tokio::time::Instant::now());
        let mut results = self.results.lock().unwrap();
        let next = if results.is_empty() {
            Ok(0)
        } else {
            results.remove(0)
        };
        async move {
            next.map(|claimed| InviteReminderReport {
                claimed,
                sent: claimed,
                failed: 0,
            })
            .map_err(|()| TeamError::StorageLayerError(anyhow::anyhow!("database down")))
        }
    }
}

fn full_batch() -> usize {
    usize::try_from(INVITE_REMINDER_BATCH).unwrap()
}

const INITIAL: Duration = Duration::from_secs(60);
const INTERVAL: Duration = Duration::from_secs(3600);

/// Runs the worker until `until` has passed, then stops it.
async fn run_for(sender: Arc<ScriptedSweeps>, until: Duration) {
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let worker = tokio::spawn(run_invite_reminder_sweep(
        sender,
        INITIAL,
        INTERVAL,
        async move {
            let _ = stopped.await;
        },
    ));
    tokio::time::sleep(until).await;
    stop.send(()).unwrap();
    worker.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn sweeps_after_the_initial_delay_then_every_interval() {
    let start = tokio::time::Instant::now();
    let sender = ScriptedSweeps::new(vec![Ok(3)]);

    run_for(
        sender.clone(),
        INITIAL + INTERVAL * 2 + Duration::from_secs(1),
    )
    .await;

    assert_eq!(
        sender.sweep_times(),
        vec![
            start + INITIAL,
            start + INITIAL + INTERVAL,
            start + INITIAL + INTERVAL * 2
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_full_batch_sweeps_again_right_away() {
    let start = tokio::time::Instant::now();
    let sender = ScriptedSweeps::new(vec![Ok(full_batch()), Ok(full_batch()), Ok(1)]);

    run_for(sender.clone(), INITIAL + Duration::from_secs(1)).await;

    assert_eq!(
        sender.sweep_times(),
        vec![start + INITIAL, start + INITIAL, start + INITIAL]
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_sweep_waits_for_the_next_interval() {
    let start = tokio::time::Instant::now();
    let sender = ScriptedSweeps::new(vec![Err(())]);

    run_for(sender.clone(), INITIAL + INTERVAL + Duration::from_secs(1)).await;

    assert_eq!(
        sender.sweep_times(),
        vec![start + INITIAL, start + INITIAL + INTERVAL]
    );
}

#[tokio::test(start_paused = true)]
async fn shutdown_before_the_first_sweep_sends_nothing() {
    let sender = ScriptedSweeps::new(vec![]);

    run_for(sender.clone(), INITIAL / 2).await;

    assert!(sender.sweep_times().is_empty());
}
