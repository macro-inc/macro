//! Fill an inbox as soon as its owner joins the Focus rollout.
//!
//! Every [`LOOK_INTERVAL`] the worker looks at every connected inbox's place
//! in the rollout, evaluating the flag in memory, so a look asks PostHog nothing.
//! An enrolled inbox this process hasn't filled yet is backfilled in two
//! passes: first its last [`FIRST_FILL_DAYS`] days, the top of the Focus tab,
//! then the rest of the window, reading due dates only for threads with mail
//! in those last days. Every first pass waiting goes before any second one,
//! so a rollout step that enrolls many inboxes at once shows each of them a
//! filled tab before any is filled to the bottom. Each pass classifies the
//! inbox's stale threads newest first, [`THREADS_AT_ONCE`] at a time, with
//! [`INBOXES_AT_ONCE`] passes running, the earliest found first.
//!
//! So an owner who joins is filled without waiting for mail, and after a
//! restart every enrolled inbox is backfilled once, which for an inbox already
//! filled reads only its few stale threads.

use std::{
    collections::{HashSet, VecDeque},
    future::Future,
    pin::Pin,
    sync::Arc,
    time::Duration,
};

use email::domain::focus::{
    DueDateExtractor, DueDates, FocusClassifier, FocusEnrollment, FocusInboxOwner, FocusNotifier,
    FocusService, FocusStore, ProfileSource, SweepReport,
};
use futures::{StreamExt as _, stream::FuturesUnordered};
use rootcause::Report;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// How often every connected inbox's place in the rollout is looked at. An
/// owner who joins is found within this plus the flag definitions' poll
/// interval.
const LOOK_INTERVAL: Duration = Duration::from_secs(60);
/// Owners' places read at once during a look.
const FLAG_CHECKS_AT_ONCE: usize = 16;
/// Days of mail the first pass covers: the top of the Focus tab.
const FIRST_FILL_DAYS: i64 = 3;
/// Backfill passes running at once.
const INBOXES_AT_ONCE: usize = 2;
/// Threads of one inbox at the classifier at once. With [`INBOXES_AT_ONCE`],
/// at most 16 classifications from backfills, beside the event stream's 16.
const THREADS_AT_ONCE: usize = 8;

/// Which part of the window a pass fills.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pass {
    /// The last [`FIRST_FILL_DAYS`] days.
    First,
    /// The whole window.
    Rest,
}

impl Pass {
    /// Due dates for the top of the tab only: the rest of the window reads none
    /// for threads last active before `first_since`, which keeps a rollout
    /// step's cost to the extractor bounded. A thread with newer mail gets
    /// its date in either pass, so mail racing a pass is never left without one.
    fn due_dates(self, first_since: chrono::DateTime<chrono::Utc>) -> DueDates {
        match self {
            Self::First => DueDates::Read,
            Self::Rest => DueDates::ReadSince(first_since),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::First => "first",
            Self::Rest => "rest",
        }
    }
}

/// An enrolled inbox waiting for a pass, with when it was found.
struct Waiting {
    inbox: FocusInboxOwner,
    found: Instant,
}

/// The inboxes found, waiting, being filled and filled.
#[derive(Default)]
struct Backfills {
    /// Inboxes waiting for their first pass, earliest found first.
    first: VecDeque<Waiting>,
    /// Inboxes whose first pass is done, waiting for the rest.
    rest: VecDeque<Waiting>,
    /// Inboxes with a pass running.
    running: HashSet<Uuid>,
    /// Inboxes filled since the worker started.
    filled: HashSet<Uuid>,
    /// Whether the classifier said stop: nothing new starts until the next look.
    paused: bool,
}

impl Backfills {
    /// Queue the enrolled inboxes not yet filled; forget those that left.
    fn found(&mut self, enrolled: Vec<FocusInboxOwner>, now: Instant) {
        let ids: HashSet<_> = enrolled.iter().map(|inbox| inbox.link_id).collect();
        self.filled.retain(|link_id| ids.contains(link_id));
        self.first
            .retain(|waiting| ids.contains(&waiting.inbox.link_id));
        self.rest
            .retain(|waiting| ids.contains(&waiting.inbox.link_id));
        for inbox in enrolled {
            let known = self.filled.contains(&inbox.link_id)
                || self.running.contains(&inbox.link_id)
                || self
                    .first
                    .iter()
                    .chain(&self.rest)
                    .any(|waiting| waiting.inbox.link_id == inbox.link_id);
            if !known {
                self.first.push_back(Waiting { inbox, found: now });
            }
        }
        self.paused = false;
    }

    /// The next pass to run, if one may start now: first passes before the rest.
    fn next(&mut self) -> Option<(Waiting, Pass)> {
        if self.paused || self.running.len() >= INBOXES_AT_ONCE {
            return None;
        }
        let next = match self.first.pop_front() {
            Some(waiting) => (waiting, Pass::First),
            None => (self.rest.pop_front()?, Pass::Rest),
        };
        self.running.insert(next.0.inbox.link_id);
        Some(next)
    }

    /// Record how a pass ended. A first pass done queues the rest; a pass the
    /// classifier stopped is dropped, so the next look queues the inbox again.
    fn done(&mut self, waiting: Waiting, pass: Pass, completed: bool, stop: bool) {
        self.running.remove(&waiting.inbox.link_id);
        match (pass, completed) {
            (Pass::First, true) => self.rest.push_back(waiting),
            (Pass::Rest, true) => {
                self.filled.insert(waiting.inbox.link_id);
            }
            (_, false) => {}
        }
        if stop {
            self.paused = true;
        }
    }
}

struct Finished {
    waiting: Waiting,
    pass: Pass,
    started: Instant,
    report: Result<SweepReport, Report>,
}

type Running = FuturesUnordered<Pin<Box<dyn Future<Output = Finished> + Send>>>;

/// Look for newly enrolled inboxes every [`LOOK_INTERVAL`] and fill them until
/// `shutdown`; a backfill cut short by shutdown is redone after the restart.
pub async fn run_backfills<S, P, C, N, D, E>(
    service: Arc<FocusService<S, P, C, N, D, E>>,
    window_days: u16,
    shutdown: CancellationToken,
) -> Result<(), Report>
where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
    N: FocusNotifier,
    D: DueDateExtractor,
    E: FocusEnrollment,
{
    let window = chrono::Duration::days(i64::from(window_days));
    let first_window = window.min(chrono::Duration::days(FIRST_FILL_DAYS));
    let mut ticker = tokio::time::interval(LOOK_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut backfills = Backfills::default();
    let mut running = Running::new();
    loop {
        tokio::select! {
            biased;
            () = shutdown.cancelled() => return Ok(()),
            Some(finished) = running.next(), if !running.is_empty() => {
                finish(&mut backfills, finished);
            }
            _ = ticker.tick() => {
                // Backfills go on while the look runs.
                let look = service.enrolled_inboxes(FLAG_CHECKS_AT_ONCE);
                tokio::pin!(look);
                let enrolled = loop {
                    tokio::select! {
                        biased;
                        () = shutdown.cancelled() => return Ok(()),
                        enrolled = &mut look => break enrolled,
                        Some(finished) = running.next(), if !running.is_empty() => {
                            finish(&mut backfills, finished);
                        }
                    }
                };
                match enrolled {
                    Ok(enrolled) => backfills.found(enrolled.enrolled, Instant::now()),
                    Err(error) => tracing::error!(error = ?error, "focus enrollment look failed"),
                }
            }
        }
        while let Some((waiting, pass)) = backfills.next() {
            let service = Arc::clone(&service);
            let window = match pass {
                Pass::First => first_window,
                Pass::Rest => window,
            };
            running.push(Box::pin(async move {
                let started = Instant::now();
                let report = service
                    .backfill(
                        &waiting.inbox,
                        window,
                        THREADS_AT_ONCE,
                        pass.due_dates(chrono::Utc::now() - first_window),
                    )
                    .await;
                Finished {
                    waiting,
                    pass,
                    started,
                    report,
                }
            }));
        }
    }
}

/// Log how a pass went and record it.
fn finish(backfills: &mut Backfills, finished: Finished) {
    let Finished {
        waiting,
        pass,
        started,
        report,
    } = finished;
    let link_id = waiting.inbox.link_id;
    let waited = started.duration_since(waiting.found).as_secs_f64();
    let took = started.elapsed().as_secs_f64();
    let since_found = waiting.found.elapsed().as_secs_f64();
    let (completed, stop) = match &report {
        Ok(report) => {
            tracing::info!(
                %link_id,
                pass = pass.name(),
                enrolled = report.inboxes == 1,
                candidates = report.candidates,
                classified = report.classified,
                redecided = report.redecided,
                skipped = report.skipped,
                failed = report.failed,
                stopped_early = report.stopped_early,
                waited_secs = waited,
                took_secs = took,
                since_found_secs = since_found,
                "focus backfill pass finished"
            );
            (!report.stopped_early, report.stopped_early)
        }
        Err(error) => {
            tracing::error!(error = ?error, %link_id, pass = pass.name(), "focus backfill pass failed");
            (false, false)
        }
    };
    backfills.done(waiting, pass, completed, stop);
}
