use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use super::*;

const LINK_ID: Uuid = Uuid::from_u128(1);

/// Scripted OpenSearch: each start returns the next task id, each progress
/// read the next scripted reply.
#[derive(Default)]
struct FakeTasks {
    starts: Mutex<VecDeque<anyhow::Result<String>>>,
    progress: Mutex<VecDeque<anyhow::Result<EmailDeleteTask>>>,
    started: Mutex<Vec<Uuid>>,
}

impl FakeTasks {
    fn new(
        starts: Vec<anyhow::Result<String>>,
        progress: Vec<anyhow::Result<EmailDeleteTask>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            starts: Mutex::new(starts.into()),
            progress: Mutex::new(progress.into()),
            started: Mutex::default(),
        })
    }
}

impl DeleteTasks for FakeTasks {
    async fn start(&self, link_id: Uuid) -> anyhow::Result<String> {
        self.started.lock().unwrap().push(link_id);
        self.starts
            .lock()
            .unwrap()
            .pop_front()
            .expect("no unscripted start")
    }

    async fn progress(&self, _task_id: &str) -> anyhow::Result<EmailDeleteTask> {
        self.progress
            .lock()
            .unwrap()
            .pop_front()
            .expect("no unscripted progress read")
    }
}

fn running() -> anyhow::Result<EmailDeleteTask> {
    Ok(EmailDeleteTask {
        completed: false,
        deleted: 5,
        total: 40,
        failure: None,
    })
}

fn done(deleted: u64) -> anyhow::Result<EmailDeleteTask> {
    Ok(EmailDeleteTask {
        completed: true,
        deleted,
        total: deleted,
        failure: None,
    })
}

fn failed() -> anyhow::Result<EmailDeleteTask> {
    Ok(EmailDeleteTask {
        completed: true,
        deleted: 0,
        total: 40,
        failure: Some("search_phase_execution_exception".into()),
    })
}

fn deletes(tasks: &Arc<FakeTasks>) -> MailboxDeletes<FakeTasks> {
    MailboxDeletes::new(
        Arc::clone(tasks),
        TaskTracker::new(),
        CancellationToken::new(),
    )
    .with_poll_interval(Duration::from_secs(1))
}

#[tokio::test(start_paused = true)]
async fn a_delete_is_followed_until_its_task_completes() {
    let tasks = FakeTasks::new(vec![], vec![running(), running(), done(40)]);

    let report = deletes(&tasks).follow(LINK_ID, "node:1".into()).await;

    assert_eq!(
        report,
        FollowReport {
            outcome: FollowOutcome::Completed,
            restarts: 0,
            deleted: 40,
            total: 40,
        }
    );
    assert!(tasks.progress.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_failed_task_is_started_once_more() {
    let tasks = FakeTasks::new(vec![Ok("node:2".into())], vec![failed(), done(40)]);

    let report = deletes(&tasks).follow(LINK_ID, "node:1".into()).await;

    assert_eq!(report.outcome, FollowOutcome::Completed);
    assert_eq!(report.restarts, 1);
    assert_eq!(*tasks.started.lock().unwrap(), [LINK_ID]);
}

#[tokio::test(start_paused = true)]
async fn a_task_that_fails_again_is_reported_failed() {
    let tasks = FakeTasks::new(vec![Ok("node:2".into())], vec![failed(), failed()]);

    let report = deletes(&tasks).follow(LINK_ID, "node:1".into()).await;

    assert_eq!(report.outcome, FollowOutcome::Failed);
    assert_eq!(report.restarts, 1);
}

#[tokio::test(start_paused = true)]
async fn unreadable_progress_counts_as_a_failure_only_after_repeated_errors() {
    let tasks = FakeTasks::new(
        vec![Ok("node:2".into())],
        vec![
            Err(anyhow::anyhow!("connect")),
            Err(anyhow::anyhow!("connect")),
            running(),
            Err(anyhow::anyhow!("connect")),
            Err(anyhow::anyhow!("connect")),
            Err(anyhow::anyhow!("connect")),
            done(40),
        ],
    );

    let report = deletes(&tasks).follow(LINK_ID, "node:1".into()).await;

    assert_eq!(report.outcome, FollowOutcome::Completed);
    assert_eq!(
        report.restarts, 1,
        "three errors in a row restart the delete"
    );
}

#[tokio::test(start_paused = true)]
async fn shutdown_stops_following_without_failing() {
    let tasks = FakeTasks::new(vec![], vec![running(), running(), running()]);
    let deletes = deletes(&tasks);
    deletes.shutdown.cancel();

    let report = deletes.follow(LINK_ID, "node:1".into()).await;

    assert_eq!(report.outcome, FollowOutcome::Unfollowed);
}

#[tokio::test(start_paused = true)]
async fn starting_returns_once_the_task_is_accepted_and_follows_in_the_background() {
    let tasks = FakeTasks::new(vec![Ok("node:1".into())], vec![running(), done(40)]);
    let deletes = deletes(&tasks);

    deletes.start(LINK_ID).await.unwrap();
    assert_eq!(*tasks.started.lock().unwrap(), [LINK_ID]);

    deletes.tracker.close();
    deletes.tracker.wait().await;
    assert!(tasks.progress.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_delete_that_cannot_start_fails_the_event() {
    let tasks = FakeTasks::new(vec![Err(anyhow::anyhow!("rejected"))], vec![]);

    assert!(deletes(&tasks).start(LINK_ID).await.is_err());
}
