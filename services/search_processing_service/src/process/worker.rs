use std::time::Duration;

use crate::process::{self, context::SearchProcessingContext};
use futures::StreamExt;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument as _;

/// How long a worker processes one message before giving up on it.
pub(crate) const MESSAGE_PROCESSING_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(300);

/// How often a message being processed has its visibility extended, well
/// inside the queue's 120 s visibility timeout.
const VISIBILITY_HEARTBEAT: Duration = Duration::from_secs(30);
/// How far each heartbeat pushes a message's visibility out.
const VISIBILITY_EXTENSION_SECONDS: i32 = 120;
/// How long one visibility change may take; the queue client has no timeout
/// of its own. It bounds a hand-back at a stop, and a stalled heartbeat gives
/// way to the next one.
const VISIBILITY_CALL_TIMEOUT: Duration = Duration::from_secs(3);
/// How long the messages a worker holds may keep running after a stop before
/// they are released to the queue. The task is killed 10 s after the stop.
const DRAIN_GRACE: Duration = Duration::from_secs(5);

/// How long a worker holding backfill units waits for its first message.
const ADMITTED_RECEIVE_WAIT_SECONDS: i32 = 2;
/// How long a worker holding backfill units waits for its receive to answer,
/// past the long-poll wait, before giving the units back. Messages a late
/// answer carried come back after the visibility timeout, one receive closer
/// to the dead-letter queue.
const ADMITTED_RECEIVE_DEADLINE: std::time::Duration =
    std::time::Duration::from_secs(ADMITTED_RECEIVE_WAIT_SECONDS as u64 + 10);
/// How long a receive still unanswered at a stop may run on. A healthy one
/// answers within its 2 s long-poll wait, and this leaves time inside the
/// stop timeout to hand back what it brings.
const STOPPED_RECEIVE_GRACE: Duration = Duration::from_secs(4);

/// How long a worker that found the queue empty waits, holding no units,
/// before it asks again: the rest of the queue's long-poll wait, so an idle
/// worker asks no more often than a long-polling one would.
fn idle_backoff(ctx: &SearchProcessingContext) -> std::time::Duration {
    let rest = ctx.worker.wait_time_seconds() - ADMITTED_RECEIVE_WAIT_SECONDS;
    std::time::Duration::from_secs(u64::try_from(rest).unwrap_or(0))
}

/// Spawns multiple search processing workers on `workers`. They take no new
/// messages after `stop`, and finish or release the ones they hold.
pub fn run_search_processing_workers(
    ctx: SearchProcessingContext,
    worker_count: u8,
    stop: CancellationToken,
    workers: &TaskTracker,
) {
    for worker_id in 0..worker_count {
        let ctx_clone = ctx.clone();
        let stop = stop.clone();
        workers.spawn(async move {
            tracing::info!(worker_id, "spawning worker");
            run_search_processing_worker_with_id(ctx_clone, worker_id, stop).await;
        });
    }
}

/// How one receive-and-process round of a worker ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Round {
    Processed,
    Empty,
    ReceiveFailed,
    Stopped,
}

/// Delay before receiving again after a receive error.
const RECEIVE_ERROR_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(1);

#[tracing::instrument(skip(ctx, stop))]
pub async fn run_search_processing_worker_with_id(
    ctx: SearchProcessingContext,
    worker_id: u8,
    stop: CancellationToken,
) {
    loop {
        let worker_result = tokio::spawn({
            let ctx = ctx.clone();
            let stop = stop.clone();
            async move {
                tracing::info!("worker started");
                let mut last_heartbeat = std::time::Instant::now();
                loop {
                    if last_heartbeat.elapsed() > std::time::Duration::from_secs(60) {
                        tracing::info!("worker heartbeat - still running");
                        last_heartbeat = std::time::Instant::now();
                    }

                    // Each round is its own trace: the worker's span never
                    // closes, so a round under it would never finish one.
                    let round = tracing::info_span!(
                        parent: None,
                        "search.queue_worker.round",
                        worker_id,
                        messages = tracing::field::Empty,
                        released = tracing::field::Empty,
                        timed_out = tracing::field::Empty,
                    );
                    let pause = match receive_and_process(&ctx, &stop).instrument(round).await {
                        Round::Processed => None,
                        Round::Empty => Some(idle_backoff(&ctx)),
                        Round::ReceiveFailed => Some(RECEIVE_ERROR_RETRY_DELAY),
                        Round::Stopped => break,
                    };
                    if let Some(pause) = pause {
                        tokio::select! {
                            () = stop.cancelled() => break,
                            () = tokio::time::sleep(pause) => {}
                        }
                    }
                }
            }
        })
        .await;

        match worker_result {
            Ok(_) if stop.is_cancelled() => {
                tracing::info!("worker stopped");
                return;
            }
            Ok(_) => {
                // This should never be hit
                tracing::error!("worker exited successfully?");
            }
            Err(e) => {
                tracing::error!(error=?e, "worker crashed with error");
            }
        }

        if stop.is_cancelled() {
            return;
        }
        // Add a delay before restarting to avoid rapid restart loops
        tracing::info!("WORKER RESTARTING...");
        tokio::select! {
            () = stop.cancelled() => return,
            () = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
        }
    }
}

/// Take backfill units, receive at most that many messages, and process them.
async fn receive_and_process(ctx: &SearchProcessingContext, stop: &CancellationToken) -> Round {
    // Units are taken before the receive, so a paused or capped worker leaves
    // messages on the queue instead of holding them; the short wait keeps an
    // idle worker from holding units another backfill could use.
    let mut batch = tokio::select! {
        biased;
        () = stop.cancelled() => return Round::Stopped,
        batch = ctx.backfill_gate.admit_up_to(ctx.messages_per_receive) => batch,
    };
    let wanted = i32::try_from(batch.units()).unwrap_or(1);
    let receive = ctx
        .worker
        .receive_messages_up_to(wanted, ADMITTED_RECEIVE_WAIT_SECONDS);
    let messages = match await_receive(receive, stop).await {
        Receive::Answered(Ok(messages)) => messages,
        Receive::Answered(Err(e)) => {
            tracing::error!(error=?e, "error receiving messages");
            return Round::ReceiveFailed;
        }
        Receive::TimedOut => {
            tracing::error!(
                deadline_seconds = ADMITTED_RECEIVE_DEADLINE.as_secs(),
                "receiving messages timed out"
            );
            return Round::ReceiveFailed;
        }
        Receive::Stopped => {
            tracing::warn!(
                "gave up on a receive still unanswered after the stop; messages it brings return after the visibility timeout"
            );
            return Round::Stopped;
        }
    };
    tracing::Span::current().record("messages", messages.len());
    if messages.is_empty() {
        return Round::Empty;
    }
    if stop.is_cancelled() {
        // Received as the service stops: hand them straight back.
        let received: Vec<_> = messages
            .iter()
            .map(|message| ReceivedMessage { ctx, message })
            .collect();
        release_all(&received).await;
        tracing::Span::current().record("released", messages.len());
        return Round::Stopped;
    }
    let admitted: Vec<_> = messages
        .into_iter()
        .map(|message| (message, batch.take_one()))
        .collect();
    drop(batch);
    let result = futures::stream::iter(admitted)
        .map(|(message, permit)| {
            let ctx = ctx.clone();
            async move {
                let result = supervise(
                    process::process_message(&ctx, &message),
                    &ReceivedMessage {
                        ctx: &ctx,
                        message: &message,
                    },
                    stop,
                )
                .await;
                drop(permit);

                match result {
                    Supervised::Finished(Ok(_)) => Ok(Outcome::Done),
                    Supervised::Finished(Err(e)) => {
                        Err((message.message_id.clone().unwrap_or_default(), e))
                    }
                    Supervised::TimedOut => {
                        tracing::error!(
                            message_id = message.message_id.as_deref().unwrap_or("unknown"),
                            "Message processing timed out after 5 minutes"
                        );
                        Ok(Outcome::TimedOut)
                    }
                    Supervised::Released => {
                        tracing::info!(
                            message_id = message.message_id.as_deref().unwrap_or("unknown"),
                            "handed a message back to the queue at the stop"
                        );
                        Ok(Outcome::Released)
                    }
                }
            }
        })
        .buffer_unordered(10)
        .collect::<Vec<Result<Outcome, (String, anyhow::Error)>>>()
        .await;

    let count = |wanted: Outcome| {
        result
            .iter()
            .filter(|outcome| outcome.as_ref().is_ok_and(|outcome| *outcome == wanted))
            .count()
    };
    let span = tracing::Span::current();
    span.record("released", count(Outcome::Released));
    span.record("timed_out", count(Outcome::TimedOut));
    for (message_id, error) in result.into_iter().filter_map(Result::err) {
        tracing::error!(message_id, error=?error, "error processing message");
    }
    if stop.is_cancelled() {
        Round::Stopped
    } else {
        Round::Processed
    }
}

/// How a receive ended.
#[derive(Debug, PartialEq, Eq)]
enum Receive<T> {
    Answered(T),
    /// Unanswered after [`ADMITTED_RECEIVE_DEADLINE`].
    TimedOut,
    /// Unanswered [`STOPPED_RECEIVE_GRACE`] after a stop.
    Stopped,
}

/// Wait for `receive`, up to its deadline, and past a stop only for
/// [`STOPPED_RECEIVE_GRACE`].
async fn await_receive<T>(
    receive: impl Future<Output = T>,
    stop: &CancellationToken,
) -> Receive<T> {
    let stopped = async {
        stop.cancelled().await;
        tokio::time::sleep(STOPPED_RECEIVE_GRACE).await;
    };
    tokio::select! {
        biased;
        answer = tokio::time::timeout(ADMITTED_RECEIVE_DEADLINE, receive) => match answer {
            Ok(answer) => Receive::Answered(answer),
            Err(_) => Receive::TimedOut,
        },
        () = stopped => Receive::Stopped,
    }
}

/// How one message of a round ended, when it did not fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Done,
    TimedOut,
    Released,
}

/// Hides a received message from other workers, or hands it back.
pub(crate) trait MessageVisibility {
    /// Keep the message hidden for `seconds` from now; 0 hands it back.
    fn hide_for(&self, seconds: i32) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Hide `message` for `seconds`, within [`VISIBILITY_CALL_TIMEOUT`].
async fn hide(message: &impl MessageVisibility, seconds: i32) -> anyhow::Result<()> {
    tokio::time::timeout(VISIBILITY_CALL_TIMEOUT, message.hide_for(seconds))
        .await
        .map_err(|_| anyhow::anyhow!("changing the message's visibility timed out"))?
}

/// Hand `message` back to the queue at once, for another worker.
async fn release(message: &impl MessageVisibility) {
    if let Err(error) = hide(message, 0).await {
        tracing::warn!(error = ?error, "failed to hand a message back to the queue; it returns after its visibility timeout");
    }
}

/// Hand every message back to the queue at once, each change within
/// [`VISIBILITY_CALL_TIMEOUT`].
async fn release_all(messages: &[impl MessageVisibility]) {
    futures::future::join_all(messages.iter().map(release)).await;
}

/// Extend `message`'s visibility every [`VISIBILITY_HEARTBEAT`] until `stop`;
/// it never ends, and is dropped with the work it keeps hidden. No heartbeat
/// starts after the stop, so none can land after the hand-back; one already
/// sent ends within [`VISIBILITY_CALL_TIMEOUT`], before [`DRAIN_GRACE`].
async fn keep_hidden(
    message: &impl MessageVisibility,
    stop: &CancellationToken,
) -> std::convert::Infallible {
    let mut heartbeat = tokio::time::interval_at(
        tokio::time::Instant::now() + VISIBILITY_HEARTBEAT,
        VISIBILITY_HEARTBEAT,
    );
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            () = stop.cancelled() => return std::future::pending().await,
            _ = heartbeat.tick() => {}
        }
        if let Err(error) = hide(message, VISIBILITY_EXTENSION_SECONDS).await {
            tracing::warn!(error = ?error, "failed to extend a message's visibility");
        }
    }
}

/// A message this task received from the search event queue.
struct ReceivedMessage<'a> {
    ctx: &'a SearchProcessingContext,
    message: &'a aws_sdk_sqs::types::Message,
}

impl MessageVisibility for ReceivedMessage<'_> {
    fn hide_for(&self, seconds: i32) -> impl Future<Output = anyhow::Result<()>> + Send {
        self.ctx.worker.extend_visibility(self.message, seconds)
    }
}

/// How the work on one message ended.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Supervised<T> {
    Finished(T),
    /// Still running after [`MESSAGE_PROCESSING_TIMEOUT`]; abandoned, and the
    /// message returns once its visibility lapses.
    TimedOut,
    /// Still running [`DRAIN_GRACE`] after a stop; abandoned and handed back.
    Released,
}

/// Run `work` for one received message: keep the message hidden while it
/// runs, give up after the processing timeout, and after a stop give it a
/// short grace before handing the message back.
pub(crate) async fn supervise<T>(
    work: impl Future<Output = T>,
    message: &impl MessageVisibility,
    stop: &CancellationToken,
) -> Supervised<T> {
    let drained = async {
        stop.cancelled().await;
        tokio::time::sleep(DRAIN_GRACE).await;
    };
    // The heartbeat runs beside the work, so a visibility change that stalls
    // holds up neither the work's end nor the drain timer.
    tokio::select! {
        biased;
        output = work => Supervised::Finished(output),
        () = drained => {
            release(message).await;
            Supervised::Released
        }
        () = tokio::time::sleep(MESSAGE_PROCESSING_TIMEOUT) => Supervised::TimedOut,
        never = keep_hidden(message, stop) => match never {},
    }
}

#[cfg(test)]
mod test;
