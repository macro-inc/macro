//! A background run's state machine: where a run of a background prompt
//! suggestion is, and how each thing that happens to it moves it.
//!
//! A run starts when the person runs the suggestion, and settles once:
//! `finished` (the suggestion is done with what the run made), `failed` (the
//! suggestion stays accepted, and running it again retries) or `cancelled`
//! (its suggestion closed while it ran). Until then it is starting, running,
//! waiting (paused on an approval, a question, or a lost runtime, since a
//! time) or being stopped. The state is stored on the run, so reading the
//! feed never asks a session how it is going.
//!
//! [`RunState::on`] is the whole machine: every (state, event) pair is either
//! a [`Step`] or a [`Refused`]. A step may carry a [`RunEffect`], which must
//! succeed before the new state is written; when it fails nothing is
//! written, and the next observation tries again. Nothing is ever given up on
//! a guess: a run settles failed only once its session is known to have
//! stopped, is gone, or was deleted.

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use macro_uuid::Uuid;
use utoipa::ToSchema;

use super::model::{SessionReadError, SessionState};

#[cfg(test)]
mod test;

/// How long a run's session has to open and take its prompt, from the run's
/// start. Past it, a session still waiting for its prompt never got it, and
/// one that is missing never opened.
pub const START_WINDOW: TimeDelta = TimeDelta::minutes(10);

/// How long a run may wait, from when it began waiting: nobody watches a
/// run, so an approval or an answer it waits for never comes, and a runtime
/// that went away mid-run doesn't come back.
pub const WAIT_WINDOW: TimeDelta = TimeDelta::minutes(10);

/// The longest a run may go, from its start, before it is stopped.
pub const MAX_RUN_TIME: TimeDelta = TimeDelta::minutes(60);

/// How long a stopped run's session has to wind down, from when the stop was
/// asked for, before it is deleted.
pub const STOP_GRACE: TimeDelta = TimeDelta::minutes(5);

/// Where a run is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState {
    /// Its row is written; its session hasn't confirmed taking the prompt.
    Starting,
    /// Its session took the prompt and is working.
    Running,
    /// Paused on something nobody will give it: an approval, an answer, or
    /// a runtime that went away mid-run.
    Waiting {
        /// When it began waiting.
        since: DateTime<Utc>,
    },
    /// Over its time: a stop was asked for; it settles failed.
    Stopping {
        /// When the stop was asked for.
        since: DateTime<Utc>,
    },
    /// Its suggestion closed while it ran: it is being stopped and settles
    /// cancelled.
    Cancelling {
        /// When it was cancelled.
        since: DateTime<Utc>,
    },
    /// Settled: done, with what it made on its suggestion.
    Finished,
    /// Settled: it stopped without finishing; running the suggestion again
    /// retries.
    Failed,
    /// Settled: stopped because its suggestion closed.
    Cancelled,
}

/// A run's state without its data: how it is stored and served.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
    strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum RunStateName {
    /// Its session is opening and taking the prompt.
    Starting,
    /// Working.
    Running,
    /// Paused on an approval, a question or a lost runtime; given up after a while.
    Waiting,
    /// Over its time and being stopped; it settles failed.
    Stopping,
    /// Its suggestion closed, and it is being stopped; it settles cancelled.
    Cancelling,
    /// Done: its result is the session and the suggestion's `produced`.
    Finished,
    /// It stopped without finishing; running the suggestion again retries.
    Failed,
    /// Stopped because its suggestion closed.
    Cancelled,
}

impl RunStateName {
    /// Settled: nothing more happens to the run.
    pub fn is_settled(self) -> bool {
        matches!(self, Self::Finished | Self::Failed | Self::Cancelled)
    }
}

impl RunState {
    /// The state as stored: `name`, entered at `changed_at`.
    pub fn stored(name: RunStateName, changed_at: DateTime<Utc>) -> Self {
        match name {
            RunStateName::Starting => Self::Starting,
            RunStateName::Running => Self::Running,
            RunStateName::Waiting => Self::Waiting { since: changed_at },
            RunStateName::Stopping => Self::Stopping { since: changed_at },
            RunStateName::Cancelling => Self::Cancelling { since: changed_at },
            RunStateName::Finished => Self::Finished,
            RunStateName::Failed => Self::Failed,
            RunStateName::Cancelled => Self::Cancelled,
        }
    }

    /// The state's name.
    pub fn name(self) -> RunStateName {
        match self {
            Self::Starting => RunStateName::Starting,
            Self::Running => RunStateName::Running,
            Self::Waiting { .. } => RunStateName::Waiting,
            Self::Stopping { .. } => RunStateName::Stopping,
            Self::Cancelling { .. } => RunStateName::Cancelling,
            Self::Finished => RunStateName::Finished,
            Self::Failed => RunStateName::Failed,
            Self::Cancelled => RunStateName::Cancelled,
        }
    }

    /// Settled: finished, failed or cancelled.
    pub fn is_settled(self) -> bool {
        self.name().is_settled()
    }

    /// When the state began, as stored: its own `since`, or `now` for a
    /// state that keeps none.
    pub fn since_or(self, now: DateTime<Utc>) -> DateTime<Utc> {
        match self {
            Self::Waiting { since } | Self::Stopping { since } | Self::Cancelling { since } => {
                since
            }
            Self::Starting | Self::Running | Self::Finished | Self::Failed | Self::Cancelled => now,
        }
    }

    /// What `event` does to a run in this state that started at
    /// `started_at`, at `now`.
    pub fn on(
        self,
        event: RunEvent,
        started_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<Step, Refused> {
        match self {
            Self::Finished | Self::Failed | Self::Cancelled => Err(Refused::Settled),
            Self::Starting | Self::Running | Self::Waiting { .. } => {
                self.live(event, started_at, now)
            }
            Self::Stopping { since } => Ok(stopping(self, Self::Failed, since, event, now)),
            Self::Cancelling { since } => Ok(stopping(self, Self::Cancelled, since, event, now)),
        }
    }

    /// A run that may still be working: starting, running or waiting.
    fn live(
        self,
        event: RunEvent,
        started_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<Step, Refused> {
        let observation = match event {
            RunEvent::Started if self == Self::Starting => return Ok(Step::to(Self::Running)),
            RunEvent::StartUncertain if self == Self::Starting => return Ok(Step::stay(self)),
            RunEvent::StartRefused if self == Self::Starting => return Ok(Step::to(Self::Failed)),
            RunEvent::Started | RunEvent::StartUncertain | RunEvent::StartRefused => {
                return Err(Refused::AlreadyStarted);
            }
            RunEvent::Cancel => return Ok(Step::to(Self::Cancelling { since: now })),
            RunEvent::Observed(observation) => observation,
        };
        let opening = now - started_at < START_WINDOW;
        let over_time = now - started_at >= MAX_RUN_TIME;
        Ok(match observation {
            Observation::Finished => Step::with(Self::Finished, RunEffect::ReadProduced),
            Observation::Failed => Step::to(Self::Failed),
            // Before its prompt is confirmed, a session may not exist yet.
            Observation::Gone if self == Self::Starting && opening => Step::stay(self),
            Observation::Gone => Step::to(Self::Failed),
            Observation::AwaitingPrompt if opening => Step::stay(self),
            // It never got its prompt: deleting it makes sure it never will.
            Observation::AwaitingPrompt => Step::with(Self::Failed, RunEffect::Delete),
            // It may be running: given up only once it is deleted.
            Observation::Unreadable if over_time => Step::with(Self::Failed, RunEffect::Delete),
            Observation::Unreadable => Step::stay(self),
            Observation::Working | Observation::Paused if over_time => {
                Step::with(Self::Stopping { since: now }, RunEffect::Stop)
            }
            Observation::Working => Step::to(Self::Running).or_stay(self),
            Observation::Paused => match self {
                Self::Waiting { since } if now - since >= WAIT_WINDOW => {
                    Step::with(Self::Stopping { since: now }, RunEffect::Stop)
                }
                Self::Waiting { .. } => Step::stay(self),
                _ => Step::to(Self::Waiting { since: now }),
            },
        })
    }
}

/// A run being stopped (`state`, since `since`), which settles as `settles`
/// unless it finished first.
fn stopping(
    state: RunState,
    settles: RunState,
    since: DateTime<Utc>,
    event: RunEvent,
    now: DateTime<Utc>,
) -> Step {
    let past_grace = now - since >= STOP_GRACE;
    match event {
        // Its session came up after the stop was asked for: stop it too.
        RunEvent::Started => Step::stay_and(state, RunEffect::Stop),
        RunEvent::StartUncertain => Step::stay(state),
        RunEvent::StartRefused => Step::to(settles),
        RunEvent::Cancel => Step::to(RunState::Cancelling { since }).or_stay(state),
        RunEvent::Observed(Observation::Finished) => {
            Step::with(RunState::Finished, RunEffect::ReadProduced)
        }
        RunEvent::Observed(Observation::Failed | Observation::Gone) => Step::to(settles),
        RunEvent::Observed(
            Observation::AwaitingPrompt
            | Observation::Working
            | Observation::Paused
            | Observation::Unreadable,
        ) => {
            if past_grace {
                Step::with(settles, RunEffect::Delete)
            } else {
                Step::stay_and(state, RunEffect::Stop)
            }
        }
    }
}

/// Something that happens to a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEvent {
    /// Its session took the prompt.
    Started,
    /// The prompt's answer was lost: it may be running, so it is never
    /// started again, and its session settles it.
    StartUncertain,
    /// Its session refused the prompt and was deleted: nothing runs.
    StartRefused,
    /// Its session was read, or said something about itself.
    Observed(Observation),
    /// Its suggestion closed (dismissed, retired or resolved).
    Cancel,
}

/// What a run's session was found doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::EnumIter)]
#[strum(serialize_all = "snake_case")]
pub enum Observation {
    /// Opened, its prompt not taken yet.
    AwaitingPrompt,
    /// Working on the prompt.
    Working,
    /// Paused: waiting for an approval or an answer, or its runtime went
    /// away mid-run.
    Paused,
    /// Its turn ended as asked.
    Finished,
    /// Its turn ended without finishing: refused, cut off, out of turns, or
    /// stopped.
    Failed,
    /// It doesn't exist: never opened, or deleted.
    Gone,
    /// It couldn't be read just now; it may well be running.
    Unreadable,
}

impl Observation {
    /// What reading a run's session found.
    pub fn of_read(read: &Result<SessionState, SessionReadError>) -> Self {
        match read {
            Ok(SessionState::AwaitingPrompt) => Self::AwaitingPrompt,
            Ok(SessionState::Running) => Self::Working,
            Ok(
                SessionState::Disconnected | SessionState::NeedsApproval | SessionState::NeedsInput,
            ) => Self::Paused,
            Ok(SessionState::Finished) => Self::Finished,
            Ok(SessionState::Failed) => Self::Failed,
            Err(SessionReadError::Missing) => Self::Gone,
            Err(SessionReadError::Unreadable(_)) => Self::Unreadable,
        }
    }
}

/// What must happen before a step's state is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum RunEffect {
    /// Read what the session made, to add to the suggestion.
    ReadProduced,
    /// Ask the session to stop its turn.
    Stop,
    /// Delete the session: nothing of it runs after.
    Delete,
}

/// Where an event moves a run, and what must happen first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Step {
    /// The run's state after; the same state when it stays.
    pub to: RunState,
    /// What must succeed before `to` is written.
    pub effect: Option<RunEffect>,
}

impl Step {
    fn to(to: RunState) -> Self {
        Self { to, effect: None }
    }

    fn stay(state: RunState) -> Self {
        Self::to(state)
    }

    fn with(to: RunState, effect: RunEffect) -> Self {
        Self {
            to,
            effect: Some(effect),
        }
    }

    fn stay_and(state: RunState, effect: RunEffect) -> Self {
        Self::with(state, effect)
    }

    /// This step, or staying in `state` when it would move to the same
    /// kind of state (keeping `state`'s `since`).
    fn or_stay(self, state: RunState) -> Self {
        if self.to.name() == state.name() {
            Self { to: state, ..self }
        } else {
            self
        }
    }

    /// Whether it moves the run (its state or its `since`).
    pub fn moves_from(&self, state: RunState) -> bool {
        self.to != state
    }
}

/// An event that doesn't apply to a run in its state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Refused {
    /// The run settled: nothing more happens to it.
    #[error("the run settled")]
    Settled,
    /// A start's result came for a run already past starting.
    #[error("the run already started")]
    AlreadyStarted,
}

/// Something a session said about itself, from its lifecycle events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionEvent {
    /// The session.
    pub session: Uuid,
    /// What it said.
    pub news: SessionNews,
}

/// What a session said about itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum SessionNews {
    /// The turn for `action` ended and nothing is queued after it;
    /// `finished` when it ended as asked.
    TurnEnded {
        /// The turn's action.
        action: Uuid,
        /// Whether it ended as asked.
        finished: bool,
    },
    /// The turn for `action` waits for an answer to a question.
    WaitingForInput {
        /// The turn's action.
        action: Uuid,
    },
    /// Something only reading the session explains: it settled with no turn
    /// on record, or its runtime stopped.
    Changed,
    /// It was deleted.
    Deleted,
}

impl SessionNews {
    /// What it says about a run whose prompt is the turn for `action`;
    /// `None` when its session must be read to know.
    pub fn about_run(self, action: Uuid) -> Option<Observation> {
        match self {
            Self::TurnEnded {
                action: ended,
                finished,
            } if ended == action => Some(if finished {
                Observation::Finished
            } else {
                Observation::Failed
            }),
            Self::WaitingForInput { action: waiting } if waiting == action => {
                Some(Observation::Paused)
            }
            Self::Deleted => Some(Observation::Gone),
            Self::TurnEnded { .. } | Self::WaitingForInput { .. } | Self::Changed => None,
        }
    }
}

/// How applying an event to a run went.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Advanced {
    /// It moved to this state.
    Moved(RunStateName),
    /// It stays where it is; what its step asked for first (a stop, say) ran.
    Stayed,
    /// The event no longer applies to it: it settled, say.
    Refused,
    /// What had to happen first failed, so nothing was written; the next
    /// event or check tries again.
    EffectFailed,
    /// Others kept moving it meanwhile; the next event or check tries again.
    Contended,
}

impl Advanced {
    /// How it shows on a span.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Moved(_) => "moved",
            Self::Stayed => "stayed",
            Self::Refused => "refused",
            Self::EffectFailed => "effect_failed",
            Self::Contended => "contended",
        }
    }
}
