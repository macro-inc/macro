//! What the supervisor does after each exit of the agent: one policy for
//! the container and the hosted unit. Its state is kept per install by the
//! caller (macrod's install store), so a macrod restart keeps the backoff,
//! the start rate and the last exit.

use std::time::Duration;

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};

use crate::exit::{self, Exit, PreviousExit};

#[cfg(test)]
mod test;

/// How far back starts and failures count.
pub const RATE_WINDOW: TimeDelta = TimeDelta::seconds(10 * 60);

/// Starts within [`RATE_WINDOW`] after which the next waits at least
/// [`RATE_CAPPED_DELAY`], so no exit loops hot.
pub const START_RATE_LIMIT: usize = 10;

/// The least wait of a start past [`START_RATE_LIMIT`].
pub const RATE_CAPPED_DELAY: Duration = Duration::from_secs(60);

/// The least wait before starting again after an unrequested exit 0.
pub const STOPPED_RESTART_DELAY: Duration = Duration::from_secs(2);

/// The wait after the first failure within [`RATE_WINDOW`]; each further
/// one doubles it, up to [`MAX_BACKOFF`].
pub const FIRST_BACKOFF: Duration = Duration::from_secs(2);

/// The longest backoff.
pub const MAX_BACKOFF: Duration = Duration::from_secs(60);

/// Failures kept: enough to reach [`MAX_BACKOFF`].
const FAILURES_KEPT: usize = 8;

/// Why the supervisor gave up until something changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Terminal {
    /// Exit 79: the code needs a newer runtime; waits for a newer image.
    IncompatibleRuntime,
    /// Exit 77: the settings are wrong; waits for a new delivery.
    BadConfiguration,
}

/// Where the agent's life is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum Phase {
    /// Never started under this state.
    Idle,
    /// Started; no exit seen since.
    Running {
        /// When it started.
        since: DateTime<Utc>,
    },
    /// Exited; starts again at `not_before`.
    Waiting {
        /// The exit, for `TEAMMATE_PREVIOUS_EXIT`.
        previous: PreviousExit,
        /// The earliest start.
        not_before: DateTime<Utc>,
    },
    /// Stopped as asked.
    Stopped,
    /// Given up until a new delivery.
    Failed {
        /// Why.
        reason: Terminal,
    },
}

/// The supervisor's state for one install, persisted between macrod runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyState {
    /// The last starts, oldest first, at most [`START_RATE_LIMIT`].
    recent_starts: Vec<DateTime<Utc>>,
    /// The last failures, oldest first, at most [`FAILURES_KEPT`].
    recent_failures: Vec<DateTime<Utc>>,
    /// Where the agent is.
    phase: Phase,
}

impl Default for PolicyState {
    fn default() -> Self {
        Self {
            recent_starts: Vec::new(),
            recent_failures: Vec::new(),
            phase: Phase::Idle,
        }
    }
}

/// An exit the supervisor saw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExitEvent {
    /// Its code, `None` when the engine lost the process.
    pub code: Option<u8>,
    /// Whether the supervisor asked for it.
    pub requested: bool,
}

/// What the supervisor does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Start after `after`, passing `previous` as `TEAMMATE_PREVIOUS_EXIT`.
    Start {
        /// The wait.
        after: Duration,
        /// The exit to pass.
        previous: PreviousExit,
    },
    /// It still runs: wait for its exit.
    Adopt,
    /// It stopped as asked.
    Stopped,
    /// Given up until a new delivery.
    Failed(Terminal),
    /// Nothing to do.
    Nothing,
}

impl PolicyState {
    /// Where the agent is.
    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// Record a start; returns the exit to pass to it as
    /// `TEAMMATE_PREVIOUS_EXIT`.
    pub fn started(&mut self, now: DateTime<Utc>) -> PreviousExit {
        self.forget_the_future(now);
        let previous = self.previous_exit();
        push_bounded(&mut self.recent_starts, now, START_RATE_LIMIT);
        self.phase = Phase::Running { since: now };
        previous
    }

    /// Record an exit and decide what follows:
    /// - a stop that was asked for is *stopped*;
    /// - 75 starts again at once, an unrequested 0 after
    ///   [`STOPPED_RESTART_DELAY`];
    /// - 79 and 77 give up until a new delivery;
    /// - anything else, 78 and a lost process included, backs off from
    ///   [`FIRST_BACKOFF`] to [`MAX_BACKOFF`] by the failures within
    ///   [`RATE_WINDOW`];
    /// - past [`START_RATE_LIMIT`] starts within [`RATE_WINDOW`], any start
    ///   waits at least [`RATE_CAPPED_DELAY`].
    pub fn exited(&mut self, event: ExitEvent, now: DateTime<Utc>) -> Action {
        self.forget_the_future(now);
        if event.requested {
            self.phase = Phase::Stopped;
            return Action::Stopped;
        }

        let previous = event
            .code
            .map_or(PreviousExit::Unknown, |code| PreviousExit::Exited { code });
        let meaning = event.code.map(Exit::of);
        let delay = match meaning {
            Some(Exit::Restart) => Duration::ZERO,
            Some(Exit::Stopped) => STOPPED_RESTART_DELAY,
            Some(Exit::IncompatibleRuntime) => {
                return self.fail(Terminal::IncompatibleRuntime);
            }
            Some(Exit::BadConfiguration) => return self.fail(Terminal::BadConfiguration),
            Some(Exit::InvalidSetting | Exit::Crash(_)) | None => self.backoff(now),
        };
        self.wait(previous, delay, now)
    }

    /// macrod started again: adopt the agent if its process still runs;
    /// else go on where the last macrod left off. An exit nobody saw is
    /// passed as unknown and backs off like a crash.
    pub fn resume(&mut self, running: bool, now: DateTime<Utc>) -> Action {
        self.forget_the_future(now);
        if running {
            if !matches!(self.phase, Phase::Running { .. }) {
                self.phase = Phase::Running { since: now };
            }
            return Action::Adopt;
        }
        match self.phase {
            Phase::Idle => Action::Start {
                after: Duration::ZERO,
                previous: PreviousExit::Unknown,
            },
            Phase::Running { .. } => {
                let delay = self.backoff(now);
                self.wait(PreviousExit::Unknown, delay, now)
            }
            Phase::Waiting {
                previous,
                not_before,
            } => Action::Start {
                after: until(now, not_before),
                previous,
            },
            Phase::Stopped | Phase::Failed { .. } => Action::Nothing,
        }
    }

    /// A new delivery (new credentials, maybe a new image) arrived: start
    /// at once, whatever was given up, with the start rate still capped.
    pub fn redelivered(&mut self, now: DateTime<Utc>) -> Action {
        self.forget_the_future(now);
        let previous = self.previous_exit();
        self.wait(previous, Duration::ZERO, now)
    }

    /// Drop times after `now`: the clock stepped back, so they are stale,
    /// and a wait never runs past the longest one a policy gives.
    fn forget_the_future(&mut self, now: DateTime<Utc>) {
        self.recent_starts.retain(|time| *time <= now);
        self.recent_failures.retain(|time| *time <= now);
        let longest =
            TimeDelta::from_std(MAX_BACKOFF.max(RATE_CAPPED_DELAY)).unwrap_or(RATE_WINDOW);
        if let Phase::Waiting { not_before, .. } = &mut self.phase
            && *not_before > now + longest
        {
            *not_before = now + longest;
        }
    }

    /// The last exit, as the next start sees it.
    fn previous_exit(&self) -> PreviousExit {
        match self.phase {
            Phase::Idle | Phase::Running { .. } => PreviousExit::Unknown,
            Phase::Waiting { previous, .. } => previous,
            Phase::Stopped => PreviousExit::Exited {
                code: exit::STOPPED,
            },
            Phase::Failed { reason } => PreviousExit::Exited {
                code: terminal_code(reason),
            },
        }
    }

    fn fail(&mut self, reason: Terminal) -> Action {
        self.phase = Phase::Failed { reason };
        Action::Failed(reason)
    }

    /// Record a failure; the backoff it earns.
    fn backoff(&mut self, now: DateTime<Utc>) -> Duration {
        push_bounded(&mut self.recent_failures, now, FAILURES_KEPT);
        let failures = within_window(&self.recent_failures, now);
        let doublings = u32::try_from(failures.saturating_sub(1)).unwrap_or(u32::MAX);
        FIRST_BACKOFF
            .checked_mul(2u32.saturating_pow(doublings.min(16)))
            .map_or(MAX_BACKOFF, |delay| delay.min(MAX_BACKOFF))
    }

    /// Wait `delay`, at least [`RATE_CAPPED_DELAY`] past the start rate.
    fn wait(&mut self, previous: PreviousExit, delay: Duration, now: DateTime<Utc>) -> Action {
        let capped = within_window(&self.recent_starts, now) >= START_RATE_LIMIT;
        let after = if capped {
            delay.max(RATE_CAPPED_DELAY)
        } else {
            delay
        };
        let not_before = TimeDelta::from_std(after).map_or(now, |wait| now + wait);
        self.phase = Phase::Waiting {
            previous,
            not_before,
        };
        Action::Start { after, previous }
    }
}

fn terminal_code(reason: Terminal) -> u8 {
    match reason {
        Terminal::IncompatibleRuntime => exit::INCOMPATIBLE_RUNTIME,
        Terminal::BadConfiguration => exit::BAD_CONFIGURATION,
    }
}

fn push_bounded(times: &mut Vec<DateTime<Utc>>, now: DateTime<Utc>, kept: usize) {
    times.push(now);
    let excess = times.len().saturating_sub(kept);
    times.drain(..excess);
}

fn within_window(times: &[DateTime<Utc>], now: DateTime<Utc>) -> usize {
    times
        .iter()
        .filter(|time| now - **time < RATE_WINDOW)
        .count()
}

fn until(now: DateTime<Utc>, then: DateTime<Utc>) -> Duration {
    (then - now).to_std().unwrap_or(Duration::ZERO)
}
