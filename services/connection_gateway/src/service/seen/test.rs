use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::DateTime;
use tokio::sync::mpsc;

use super::*;

const ADA: &str = "macro|ada@example.com";
const BEA: &str = "macro|bea@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

/// Reports every write it is asked for, sorted, and fails the first
/// `failures` of them.
struct FakeLog {
    writes: mpsc::UnboundedSender<Vec<String>>,
    failures: Arc<AtomicUsize>,
}

impl SeenLog for FakeLog {
    type Err = std::io::Error;

    async fn record_seen(
        &self,
        users: &[MacroUserIdStr<'static>],
        _at: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        let mut ids: Vec<String> = users.iter().map(|user| user.as_ref().to_owned()).collect();
        ids.sort();
        let _ = self.writes.send(ids);
        let failed = self
            .failures
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                left.checked_sub(1)
            })
            .is_ok();
        if failed {
            return Err(std::io::Error::other("database unavailable"));
        }
        Ok(())
    }
}

struct Started {
    recorder: SeenRecorder,
    writes: mpsc::UnboundedReceiver<Vec<String>>,
    tracker: TaskTracker,
    cancel: CancellationToken,
}

fn start(failures: usize) -> Started {
    let (tx, writes) = mpsc::unbounded_channel();
    let tracker = TaskTracker::new();
    let cancel = CancellationToken::new();
    let recorder = SeenRecorder::start(
        FakeLog {
            writes: tx,
            failures: Arc::new(AtomicUsize::new(failures)),
        },
        &tracker,
        cancel.clone(),
    );
    Started {
        recorder,
        writes,
        tracker,
        cancel,
    }
}

async fn next_write(writes: &mut mpsc::UnboundedReceiver<Vec<String>>) -> (Vec<String>, Duration) {
    let asked = Instant::now();
    let write = writes.recv().await.expect("the recorder is running");
    (write, asked.elapsed())
}

#[tokio::test(start_paused = true)]
async fn marks_in_one_round_are_written_together_once() {
    let mut started = start(0);
    started.recorder.mark(&user(ADA));
    started.recorder.mark(&user(BEA));
    started.recorder.mark(&user(ADA));

    let (write, after) = next_write(&mut started.writes).await;
    assert_eq!(write, [ADA, BEA]);
    assert!(after <= FLUSH_EVERY);
}

#[tokio::test(start_paused = true)]
async fn a_person_written_within_the_hour_is_not_written_again() {
    let mut started = start(0);
    started.recorder.mark(&user(ADA));
    assert_eq!(next_write(&mut started.writes).await.0, [ADA]);

    // Ada's second tab opens: nothing new to say about her. Bea's write is
    // the next one, and it carries Bea alone.
    tokio::time::advance(FLUSH_EVERY).await;
    started.recorder.mark(&user(ADA));
    started.recorder.mark(&user(BEA));
    assert_eq!(next_write(&mut started.writes).await.0, [BEA]);

    // An hour after Ada was written, a mark writes her again.
    tokio::time::advance(MARK_EVERY).await;
    started.recorder.mark(&user(ADA));
    assert_eq!(next_write(&mut started.writes).await.0, [ADA]);
}

#[tokio::test(start_paused = true)]
async fn a_failed_write_is_tried_again_next_round() {
    let mut started = start(1);
    started.recorder.mark(&user(ADA));

    assert_eq!(next_write(&mut started.writes).await.0, [ADA]);
    let (retry, after) = next_write(&mut started.writes).await;
    assert_eq!(retry, [ADA]);
    assert_eq!(after, FLUSH_EVERY);
}

#[tokio::test(start_paused = true)]
async fn an_open_connection_marks_its_person_on_open_and_every_hour() {
    let mut started = start(0);
    let open = tokio::spawn(started.recorder.mark_while_open(user(ADA)));

    let (first, after) = next_write(&mut started.writes).await;
    assert_eq!(first, [ADA]);
    assert!(after <= FLUSH_EVERY);

    let (second, after) = next_write(&mut started.writes).await;
    assert_eq!(second, [ADA]);
    assert!(after >= MARK_EVERY - FLUSH_EVERY);
    assert!(after <= MARK_EVERY + FLUSH_EVERY);

    // Closed, the connection marks nothing more: the next write is Bea's.
    open.abort();
    let _ = open.await;
    tokio::time::advance(MARK_EVERY).await;
    started.recorder.mark(&user(BEA));
    assert_eq!(next_write(&mut started.writes).await.0, [BEA]);
}

#[tokio::test(start_paused = true)]
async fn a_connection_that_closes_at_once_is_still_seen() {
    let mut started = start(0);
    // The connection closes before anything polls its marking.
    let marking = started.recorder.mark_while_open(user(ADA));
    drop(marking);

    let write = tokio::time::timeout(FLUSH_EVERY * 2, next_write(&mut started.writes)).await;
    assert_eq!(
        write.ok().map(|(write, _)| write),
        Some(vec![ADA.to_owned()])
    );
}

#[tokio::test(start_paused = true)]
async fn stopping_writes_what_was_marked_and_ends_the_task() {
    let mut started = start(0);
    // Let the first, empty round pass so the stop is what writes Ada.
    tokio::time::advance(Duration::from_secs(1)).await;
    started.recorder.mark(&user(ADA));

    started.cancel.cancel();
    started.tracker.close();
    started.tracker.wait().await;

    let (write, after) = next_write(&mut started.writes).await;
    assert_eq!(write, [ADA]);
    assert_eq!(after, Duration::ZERO);
    assert!(started.writes.recv().await.is_none(), "the task ended");
}
