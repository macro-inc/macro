//! Seen times: when a person had a signed-in Macro client open, which the
//! activity check (`activity::UserActivity`) counts as them being around.
//!
//! A connection marks its user when it opens and every hour it stays open.
//! Marks are gathered here and written in one batch per round, so a socket
//! never waits on the database (CS-48), and a user written within the hour is
//! not written again for another of their connections on this instance.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use activity::SeenLog;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::time::{Instant, MissedTickBehavior};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument as _;

#[cfg(test)]
mod test;

/// How often an open connection marks its user again.
pub const MARK_EVERY: Duration = Duration::from_secs(60 * 60);

/// How often gathered marks are written.
pub const FLUSH_EVERY: Duration = Duration::from_secs(30);

/// A user written this recently is not written again. Shorter than
/// [`MARK_EVERY`] by more than a round, so a connection's hourly mark always
/// gets through.
const WRITTEN_WITHIN: Duration = Duration::from_secs(55 * 60);

type Marked = Arc<Mutex<HashSet<MacroUserIdStr<'static>>>>;

/// Gathers the users this instance's connections mark as seen.
#[derive(Clone, Default)]
pub struct SeenRecorder {
    marked: Marked,
}

impl SeenRecorder {
    /// Starts writing marks to `log` every [`FLUSH_EVERY`]. Once `cancel`
    /// fires, the marks gathered so far are written and the task ends.
    pub fn start<L>(log: L, tracker: &TaskTracker, cancel: CancellationToken) -> Self
    where
        L: SeenLog + Send + Sync + 'static,
    {
        let recorder = Self::default();
        tracker.spawn(flush_rounds(Arc::clone(&recorder.marked), log, cancel));
        recorder
    }

    /// Marks `user` as seen now; the next round writes it.
    pub fn mark(&self, user: &MacroUserIdStr<'static>) {
        lock(&self.marked).insert(user.clone());
    }

    /// Marks `user` now and returns the future that marks them again every
    /// [`MARK_EVERY`] from this mark. The first mark does not wait for the
    /// future to be polled, so a connection that closes at once is still
    /// seen. The future never finishes: run it beside the connection, which
    /// drops it when it closes.
    pub fn mark_while_open(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = ()> + Send + 'static {
        self.mark(&user);
        let next = Instant::now() + MARK_EVERY;
        let recorder = self.clone();
        async move {
            let mut every = tokio::time::interval_at(next, MARK_EVERY);
            every.set_missed_tick_behavior(MissedTickBehavior::Delay);
            loop {
                every.tick().await;
                recorder.mark(&user);
            }
        }
    }
}

/// A poisoned set still holds valid ids: a panic elsewhere must not stop
/// connections from being recorded.
fn lock(marked: &Marked) -> MutexGuard<'_, HashSet<MacroUserIdStr<'static>>> {
    marked.lock().unwrap_or_else(PoisonError::into_inner)
}

async fn flush_rounds<L: SeenLog>(marked: Marked, log: L, cancel: CancellationToken) {
    let mut written = HashMap::new();
    let mut every = tokio::time::interval(FLUSH_EVERY);
    every.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        let stopping = tokio::select! {
            () = cancel.cancelled() => true,
            _ = every.tick() => false,
        };
        flush(&marked, &log, &mut written).await;
        if stopping {
            break;
        }
    }
}

/// Writes the marked users not written within [`WRITTEN_WITHIN`]. A failed
/// write puts them back for the next round.
async fn flush<L: SeenLog>(
    marked: &Marked,
    log: &L,
    written: &mut HashMap<MacroUserIdStr<'static>, Instant>,
) {
    let now = Instant::now();
    written.retain(|_, at| now.duration_since(*at) < WRITTEN_WITHIN);
    let (due, skipped) = {
        let mut marked = lock(marked);
        let total = marked.len();
        let due: Vec<_> = marked
            .drain()
            .filter(|user| !written.contains_key(user))
            .collect();
        let skipped = total - due.len();
        (due, skipped)
    };
    if due.is_empty() {
        return;
    }

    let span = tracing::info_span!(
        "connection_gateway.record_seen",
        users = due.len(),
        skipped,
        otel.status_code = tracing::field::Empty,
    );
    match log
        .record_seen(&due, Utc::now())
        .instrument(span.clone())
        .await
    {
        Ok(()) => written.extend(due.into_iter().map(|user| (user, now))),
        Err(error) => {
            span.record("otel.status_code", "ERROR");
            tracing::warn!(
                parent: &span,
                error = ?error,
                "seen times not written; kept for the next round"
            );
            lock(marked).extend(due);
        }
    }
}
