use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};

use super::*;

const LINK_ID: Uuid = Uuid::from_u128(1);

type Reply = anyhow::Result<Option<EmailDeleteTask>>;

/// Scripted OpenSearch: each start returns the next scripted id, and each
/// progress read the task's next scripted reply. A task with no reply left
/// never answers, like a request that hangs.
#[derive(Default)]
struct FakeTasks {
    starts: Mutex<VecDeque<anyhow::Result<EmailDeleteTaskId>>>,
    progress: Mutex<HashMap<EmailDeleteTaskId, VecDeque<Reply>>>,
    started: Mutex<Vec<Uuid>>,
}

impl FakeTasks {
    fn new(
        starts: Vec<anyhow::Result<EmailDeleteTaskId>>,
        progress: Vec<(EmailDeleteTaskId, Vec<Reply>)>,
    ) -> Arc<Self> {
        Arc::new(Self {
            starts: Mutex::new(starts.into()),
            progress: Mutex::new(
                progress
                    .into_iter()
                    .map(|(id, replies)| (id, replies.into()))
                    .collect(),
            ),
            started: Mutex::default(),
        })
    }

    fn started(&self) -> Vec<Uuid> {
        self.started.lock().unwrap().clone()
    }

    fn unread_replies(&self) -> usize {
        self.progress
            .lock()
            .unwrap()
            .values()
            .map(VecDeque::len)
            .sum()
    }
}

impl DeleteTasks for FakeTasks {
    async fn start(&self, link_id: Uuid) -> anyhow::Result<EmailDeleteTaskId> {
        self.started.lock().unwrap().push(link_id);
        self.starts
            .lock()
            .unwrap()
            .pop_front()
            .expect("no unscripted start")
    }

    async fn progress(&self, task_id: &EmailDeleteTaskId) -> Reply {
        let reply = self
            .progress
            .lock()
            .unwrap()
            .get_mut(task_id)
            .and_then(VecDeque::pop_front);
        match reply {
            Some(reply) => reply,
            None => std::future::pending().await,
        }
    }
}

fn id(number: u32) -> EmailDeleteTaskId {
    EmailDeleteTaskId::try_from(format!("node:{number}")).unwrap()
}

fn task(state: EmailDeleteState, deleted: u64) -> Reply {
    Ok(Some(EmailDeleteTask {
        deleted,
        total: 40,
        state,
    }))
}

fn running() -> Reply {
    task(EmailDeleteState::Running, 5)
}

fn done() -> Reply {
    task(EmailDeleteState::Completed, 40)
}

fn failed() -> Reply {
    task(
        EmailDeleteState::Failed("search_phase_execution_exception".into()),
        12,
    )
}

fn unreadable() -> Reply {
    Err(anyhow::anyhow!("connect"))
}

fn deletes(tasks: &Arc<FakeTasks>) -> MailboxDeletes<FakeTasks> {
    MailboxDeletes::new(
        Arc::clone(tasks),
        TaskTracker::new(),
        CancellationToken::new(),
    )
    .with_poll_interval(Duration::from_secs(1))
}

async fn drain(deletes: &MailboxDeletes<FakeTasks>) {
    deletes.tracker.close();
    deletes.tracker.wait().await;
}

#[tokio::test(start_paused = true)]
async fn a_delete_is_followed_until_its_task_completes() {
    let tasks = FakeTasks::new(vec![], vec![(id(1), vec![running(), running(), done()])]);

    let report = deletes(&tasks).follow(LINK_ID, id(1)).await;

    assert_eq!(
        report,
        FollowReport {
            outcome: FollowOutcome::Completed,
            restarts: 0,
            deleted: 40,
            total: 40,
        }
    );
    assert_eq!(tasks.unread_replies(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_failed_task_is_started_once_more() {
    let tasks = FakeTasks::new(
        vec![Ok(id(2))],
        vec![(id(1), vec![failed()]), (id(2), vec![done()])],
    );

    let report = deletes(&tasks).follow(LINK_ID, id(1)).await;

    assert_eq!(report.outcome, FollowOutcome::Completed);
    assert_eq!(report.restarts, 1);
    assert_eq!(tasks.started(), [LINK_ID]);
}

#[tokio::test(start_paused = true)]
async fn a_task_that_fails_again_is_reported_failed_with_its_counts() {
    let tasks = FakeTasks::new(
        vec![Ok(id(2))],
        vec![(id(1), vec![failed()]), (id(2), vec![failed()])],
    );

    let report = deletes(&tasks).follow(LINK_ID, id(1)).await;

    assert_eq!(
        report,
        FollowReport {
            outcome: FollowOutcome::Failed,
            restarts: 1,
            deleted: 12,
            total: 40,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_task_opensearch_no_longer_knows_is_started_once_more() {
    let tasks = FakeTasks::new(
        vec![Ok(id(2))],
        vec![(id(1), vec![running(), Ok(None)]), (id(2), vec![done()])],
    );

    let report = deletes(&tasks).follow(LINK_ID, id(1)).await;

    assert_eq!(report.outcome, FollowOutcome::Completed);
    assert_eq!(report.restarts, 1);
}

#[tokio::test(start_paused = true)]
async fn unreadable_progress_stops_following_without_starting_another_task() {
    let tasks = FakeTasks::new(
        vec![],
        vec![(
            id(1),
            vec![
                unreadable(),
                unreadable(),
                running(),
                unreadable(),
                unreadable(),
                unreadable(),
            ],
        )],
    );

    let report = deletes(&tasks).follow(LINK_ID, id(1)).await;

    assert_eq!(report.outcome, FollowOutcome::Unreadable);
    assert_eq!(report.restarts, 0);
    assert!(
        tasks.started().is_empty(),
        "the first task may still be running"
    );
}

#[tokio::test(start_paused = true)]
async fn a_cancelled_task_is_not_started_again() {
    let tasks = FakeTasks::new(
        vec![],
        vec![(
            id(1),
            vec![task(
                EmailDeleteState::Canceled("by user request".into()),
                10,
            )],
        )],
    );

    let report = deletes(&tasks).follow(LINK_ID, id(1)).await;

    assert_eq!(report.outcome, FollowOutcome::Canceled);
    assert!(tasks.started().is_empty());
}

#[tokio::test(start_paused = true)]
async fn shutdown_stops_following_without_failing() {
    let tasks = FakeTasks::new(vec![], vec![(id(1), vec![running(), running()])]);
    let deletes = deletes(&tasks);
    deletes.shutdown.cancel();

    let report = deletes.follow(LINK_ID, id(1)).await;

    assert_eq!(report.outcome, FollowOutcome::Unfollowed);
}

#[tokio::test(start_paused = true)]
async fn shutdown_interrupts_a_progress_read_that_hangs() {
    let tasks = FakeTasks::new(vec![], vec![]);
    let deletes = deletes(&tasks);
    let following = tokio::spawn({
        let deletes = deletes.clone();
        async move { deletes.follow(LINK_ID, id(1)).await }
    });

    tokio::time::sleep(Duration::from_secs(10)).await;
    deletes.shutdown.cancel();

    assert_eq!(following.await.unwrap().outcome, FollowOutcome::Unfollowed);
}

#[tokio::test(start_paused = true)]
async fn starting_returns_once_the_task_is_accepted_and_follows_in_the_background() {
    let tasks = FakeTasks::new(vec![Ok(id(1))], vec![(id(1), vec![running(), done()])]);
    let deletes = deletes(&tasks);

    deletes.start(LINK_ID).await.unwrap();
    assert_eq!(tasks.started(), [LINK_ID]);

    drain(&deletes).await;
    assert_eq!(tasks.unread_replies(), 0);
}

#[tokio::test]
async fn a_delete_that_cannot_start_fails_the_event() {
    let tasks = FakeTasks::new(vec![Err(anyhow::anyhow!("rejected"))], vec![]);

    assert!(deletes(&tasks).start(LINK_ID).await.is_err());
}

#[tokio::test(start_paused = true)]
async fn at_most_two_deletes_run_at_once_and_the_rest_wait_their_turn() {
    let links = [Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(3)];
    let tasks = FakeTasks::new(
        vec![Ok(id(1)), Ok(id(2)), Ok(id(3))],
        vec![
            (id(1), vec![running(), done()]),
            (id(2), vec![running(), running(), done()]),
            (id(3), vec![done()]),
        ],
    );
    let deletes = deletes(&tasks);

    for link in links {
        deletes.start(link).await.unwrap();
    }
    assert_eq!(
        tasks.started(),
        links[..MAX_RUNNING],
        "the third waits for a slot"
    );

    drain(&deletes).await;
    assert_eq!(tasks.started(), links);
    assert_eq!(tasks.unread_replies(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_delete_still_waiting_at_shutdown_is_not_started() {
    let tasks = FakeTasks::new(vec![Ok(id(1)), Ok(id(2))], vec![]);
    let deletes = deletes(&tasks);
    for link in 1..=3 {
        deletes.start(Uuid::from_u128(link)).await.unwrap();
    }

    deletes.shutdown.cancel();
    drain(&deletes).await;

    assert_eq!(tasks.started().len(), MAX_RUNNING);
}

#[tokio::test(start_paused = true)]
async fn a_waiting_delete_tries_to_start_three_times() {
    let tasks = FakeTasks::new(
        vec![
            Ok(id(1)),
            Ok(id(2)),
            Err(anyhow::anyhow!("rejected")),
            Err(anyhow::anyhow!("rejected")),
            Ok(id(3)),
        ],
        vec![
            (id(1), vec![done()]),
            (id(2), vec![done()]),
            (id(3), vec![done()]),
        ],
    );
    let deletes = deletes(&tasks);
    for link in 1..=3 {
        deletes.start(Uuid::from_u128(link)).await.unwrap();
    }

    drain(&deletes).await;

    assert_eq!(tasks.started().len(), 5);
    assert_eq!(tasks.unread_replies(), 0);
}
