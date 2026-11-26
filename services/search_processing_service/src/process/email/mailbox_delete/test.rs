use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};

use super::*;

const LINK_ID: Uuid = Uuid::from_u128(1);

type Reply = anyhow::Result<Option<EmailDeleteTask>>;

/// A scripted answer; `Hang` never answers, like a request that hangs.
enum Scripted<T> {
    Answer(T),
    Hang,
}

impl<T> From<T> for Scripted<T> {
    fn from(answer: T) -> Self {
        Self::Answer(answer)
    }
}

/// Scripted OpenSearch: each start returns the next scripted id, and each
/// progress read the task's next scripted reply. Anything unscripted panics,
/// so an extra start or read fails the test instead of hanging it.
#[derive(Default)]
struct FakeTasks {
    starts: Mutex<VecDeque<Scripted<anyhow::Result<EmailDeleteTaskId>>>>,
    progress: Mutex<HashMap<EmailDeleteTaskId, VecDeque<Scripted<Reply>>>>,
    started: Mutex<Vec<Uuid>>,
    refreshes: std::sync::atomic::AtomicUsize,
}

impl FakeTasks {
    fn new(
        starts: Vec<anyhow::Result<EmailDeleteTaskId>>,
        progress: Vec<(EmailDeleteTaskId, Vec<Reply>)>,
    ) -> Arc<Self> {
        Self::scripted(
            starts.into_iter().map(Scripted::from).collect(),
            progress
                .into_iter()
                .map(|(id, replies)| (id, replies.into_iter().map(Scripted::from).collect()))
                .collect(),
        )
    }

    fn scripted(
        starts: Vec<Scripted<anyhow::Result<EmailDeleteTaskId>>>,
        progress: Vec<(EmailDeleteTaskId, Vec<Scripted<Reply>>)>,
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
            refreshes: std::sync::atomic::AtomicUsize::default(),
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
        let scripted = self.starts.lock().unwrap().pop_front();
        match scripted.expect("no unscripted start") {
            Scripted::Answer(result) => result,
            Scripted::Hang => std::future::pending().await,
        }
    }

    async fn progress(&self, task_id: &EmailDeleteTaskId) -> Reply {
        let reply = self
            .progress
            .lock()
            .unwrap()
            .get_mut(task_id)
            .and_then(VecDeque::pop_front);
        match reply.expect("no unscripted progress read") {
            Scripted::Answer(reply) => reply,
            Scripted::Hang => std::future::pending().await,
        }
    }

    async fn refresh(&self) -> anyhow::Result<()> {
        self.refreshes
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
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
            poll_errors: 0,
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
    assert_eq!(
        tasks.refreshes.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "the replacement starts after a refresh"
    );
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
            poll_errors: 0,
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
async fn unreadable_progress_keeps_following_without_starting_another_task() {
    let tasks = FakeTasks::new(
        vec![],
        vec![(
            id(1),
            vec![
                unreadable(),
                unreadable(),
                unreadable(),
                unreadable(),
                running(),
                done(),
            ],
        )],
    );

    let report = deletes(&tasks).follow(LINK_ID, id(1)).await;

    assert_eq!(report.outcome, FollowOutcome::Completed);
    assert_eq!(report.restarts, 0);
    assert!(
        tasks.started().is_empty(),
        "the first task was still running"
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
    let tasks = FakeTasks::scripted(vec![], vec![(id(1), vec![Scripted::Hang])]);
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
    let tasks = FakeTasks::scripted(
        vec![Ok(id(1)).into(), Ok(id(2)).into()],
        vec![(id(1), vec![Scripted::Hang]), (id(2), vec![Scripted::Hang])],
    );
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

#[tokio::test(start_paused = true)]
async fn a_start_cut_off_by_shutdown_is_reported_as_possibly_accepted() {
    let tasks = FakeTasks::scripted(vec![Scripted::Hang], vec![]);
    let deletes = deletes(&tasks);
    let starting = tokio::spawn({
        let deletes = deletes.clone();
        async move { deletes.start_task(LINK_ID).await }
    });

    tokio::time::sleep(Duration::from_secs(1)).await;
    deletes.shutdown.cancel();

    assert!(matches!(starting.await.unwrap(), Start::Interrupted));
    assert_eq!(tasks.started(), [LINK_ID]);
}

#[tokio::test(start_paused = true)]
async fn nothing_is_sent_once_shutdown_has_begun() {
    let tasks = FakeTasks::new(vec![Ok(id(1))], vec![]);
    let deletes = deletes(&tasks);
    deletes.shutdown.cancel();

    assert!(matches!(deletes.start_task(LINK_ID).await, Start::NotSent));
    assert!(tasks.started().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_delete_whose_progress_is_unreadable_keeps_its_slot() {
    let links = [Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(3)];
    let unreadable_then_done = || {
        let mut replies: Vec<Reply> = (0..5).map(|_| unreadable()).collect();
        replies.push(done());
        replies
    };
    let tasks = FakeTasks::new(
        vec![Ok(id(1)), Ok(id(2)), Ok(id(3))],
        vec![
            (id(1), unreadable_then_done()),
            (id(2), unreadable_then_done()),
            (id(3), vec![done()]),
        ],
    );
    let deletes = deletes(&tasks);
    for link in links {
        deletes.start(link).await.unwrap();
    }

    tokio::time::sleep(Duration::from_secs(4)).await;
    assert_eq!(
        tasks.started(),
        links[..MAX_RUNNING],
        "both slots stay taken"
    );

    drain(&deletes).await;
    assert_eq!(tasks.started(), links);
}

#[tokio::test(start_paused = true)]
async fn progress_unreadable_for_too_long_ends_the_follow() {
    let mut replies = vec![running()];
    replies.extend((0..=UNREADABLE_LIMIT.as_secs() + 1).map(|_| unreadable()));
    let tasks = FakeTasks::new(vec![], vec![(id(1), replies)]);

    let report = deletes(&tasks).follow(LINK_ID, id(1)).await;

    assert_eq!(report.outcome, FollowOutcome::Unreadable);
    assert!(report.poll_errors > 0);
    assert!(tasks.started().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_second_event_for_a_followed_inbox_starts_nothing_more() {
    let tasks = FakeTasks::new(vec![Ok(id(1))], vec![(id(1), vec![running(), done()])]);
    let deletes = deletes(&tasks);

    deletes.start(LINK_ID).await.unwrap();
    deletes.start(LINK_ID).await.unwrap();

    assert_eq!(tasks.started(), [LINK_ID]);
    drain(&deletes).await;
}

#[tokio::test(start_paused = true)]
async fn a_replacement_start_cut_off_by_shutdown_reports_the_failed_task() {
    let tasks = FakeTasks::scripted(vec![Scripted::Hang], vec![(id(1), vec![failed().into()])]);
    let deletes = deletes(&tasks);
    let following = tokio::spawn({
        let deletes = deletes.clone();
        async move { deletes.follow(LINK_ID, id(1)).await }
    });

    tokio::time::sleep(Duration::from_secs(5)).await;
    deletes.shutdown.cancel();

    let report = following.await.unwrap();
    assert_eq!(report.outcome, FollowOutcome::StartInterrupted);
    assert_eq!((report.deleted, report.total), (12, 40));
}
