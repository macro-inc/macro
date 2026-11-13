//! A generation session's lifecycle: how its turn ends, and how far its
//! cleanup got.
//!
//! ```text
//! open ──ended──▶ stopping ──deleted──▶ deleted
//!                  │    ▲
//!                  │    └─delete failed (retried by the sweep)
//!                  └──gave up──▶ abandoned
//! ```
//!
//! Only an open session may call its kind's tools. Until it is deleted its
//! code keeps a generation session's narrow scope. Its ending is stored when
//! it leaves `open`, before what it changed is counted.

use agent_session::domain::routines::{
    RoutineActionStatus, RoutineFailureReason, RoutinePendingReason,
};
use strum::IntoEnumIterator as _;

#[cfg(test)]
mod test;

/// Deleting a session is tried this many times, the sweep retrying after
/// each failure, before its cleanup is abandoned.
pub const MAX_CLEANUP_ATTEMPTS: u8 = 5;

/// How a generation session's turn ended.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    strum::EnumString,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::EnumIter,
)]
#[strum(serialize_all = "snake_case")]
pub enum SessionEnding {
    /// Its turn ended on its own.
    Finished,
    /// Its turn failed (a refusal, a budget, a runtime error), it stopped to
    /// wait for an approval or an answer nobody will give, or it couldn't be
    /// started or read.
    Failed,
    /// It ran past its kind's timeout.
    TimedOut,
    /// The prompt may or may not have reached it.
    DeliveryUnknown,
    /// Its process is stopping.
    Cancelled,
    /// Its generation stopped running without it: its heartbeat was lost,
    /// or its process died.
    Interrupted,
}

impl SessionEnding {
    /// Whether its turn may still be running, so cleanup stops it before
    /// deleting it.
    pub fn turn_may_run(self) -> bool {
        self != Self::Finished
    }
}

/// What one status read says about a session's turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Poll {
    /// The turn ended so; the reason names a failure for the span.
    Ended(SessionEnding, Option<&'static str>),
    /// Keep waiting.
    Waiting,
}

/// What `status` says about a generation session's turn. A session waiting
/// for a person's approval or answer has failed: generation sessions are
/// hidden, and nobody will give either.
pub fn poll(status: &RoutineActionStatus) -> Poll {
    match status {
        RoutineActionStatus::Succeeded => Poll::Ended(SessionEnding::Finished, None),
        RoutineActionStatus::Failed(reason) => {
            Poll::Ended(SessionEnding::Failed, Some(failure(*reason)))
        }
        RoutineActionStatus::Pending(RoutinePendingReason::Permission) => {
            Poll::Ended(SessionEnding::Failed, Some("permission"))
        }
        RoutineActionStatus::Pending(RoutinePendingReason::Elicitation) => {
            Poll::Ended(SessionEnding::Failed, Some("elicitation"))
        }
        RoutineActionStatus::Pending(
            RoutinePendingReason::AwaitingPrompt
            | RoutinePendingReason::Running
            | RoutinePendingReason::Disconnected,
        ) => Poll::Waiting,
    }
}

fn failure(reason: RoutineFailureReason) -> &'static str {
    match reason {
        RoutineFailureReason::Cancelled => "cancelled",
        RoutineFailureReason::Refusal => "refusal",
        RoutineFailureReason::MaxTokens => "max_tokens",
        RoutineFailureReason::MaxTurnRequests => "max_turn_requests",
        RoutineFailureReason::RuntimeError => "runtime_error",
        RoutineFailureReason::UnknownStopReason => "unknown_stop_reason",
    }
}

/// How far a generation session's cleanup got.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    strum::EnumString,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::EnumIter,
)]
#[strum(serialize_all = "snake_case")]
pub enum Cleanup {
    /// Its turn runs; it may call its kind's tools.
    Open,
    /// Its turn ended; its tools refuse it, and it is being stopped and
    /// deleted.
    Stopping,
    /// The session is deleted, or was never stored.
    Deleted,
    /// Deleting it kept failing; it stays, hidden.
    Abandoned,
}

/// What moves a session's cleanup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumIter)]
pub enum CleanupEvent {
    /// Its turn ended; the ending is stored with it.
    Ended,
    /// Deleting it succeeded, or it is confirmed missing.
    Deleted,
    /// Deleting it failed; the sweep tries again.
    DeleteFailed,
    /// Deleting it failed [`MAX_CLEANUP_ATTEMPTS`] times.
    GaveUp,
}

/// A transition the table doesn't have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a {from:?} session can't take {event:?}")]
pub struct CleanupRefused {
    /// The state it was in.
    pub from: Cleanup,
    /// What was refused.
    pub event: CleanupEvent,
}

impl Cleanup {
    /// The state `event` moves a session in this state to.
    pub fn on(self, event: CleanupEvent) -> Result<Self, CleanupRefused> {
        use CleanupEvent as Event;
        match (self, event) {
            (Self::Open, Event::Ended) => Ok(Self::Stopping),
            (Self::Stopping, Event::Deleted) => Ok(Self::Deleted),
            (Self::Stopping, Event::DeleteFailed) => Ok(Self::Stopping),
            (Self::Stopping, Event::GaveUp) => Ok(Self::Abandoned),
            (Self::Open, Event::Deleted | Event::DeleteFailed | Event::GaveUp)
            | (Self::Stopping, Event::Ended)
            | (Self::Deleted | Self::Abandoned, _) => Err(CleanupRefused { from: self, event }),
        }
    }

    /// Whether the session may call its kind's tools.
    pub fn takes_tools(self) -> bool {
        self == Self::Open
    }

    /// Whether the session still exists as far as its row knows: its code
    /// keeps a generation session's scope.
    pub fn undeleted(self) -> bool {
        matches!(self, Self::Open | Self::Stopping)
    }
}

impl CleanupEvent {
    /// The states this event may leave, as storage guards its write.
    pub fn sources(self) -> Vec<Cleanup> {
        Cleanup::iter()
            .filter(|state| state.on(self).is_ok())
            .collect()
    }

    /// The state this event enters.
    pub fn entered(self) -> Cleanup {
        match self {
            Self::Ended | Self::DeleteFailed => Cleanup::Stopping,
            Self::Deleted => Cleanup::Deleted,
            Self::GaveUp => Cleanup::Abandoned,
        }
    }

    /// Whether it counts one more failed delete.
    pub fn counts_attempt(self) -> bool {
        matches!(self, Self::DeleteFailed | Self::GaveUp)
    }

    /// The event a failed delete is, after `attempts` failed before it.
    pub fn delete_failed(attempts: u8) -> Self {
        if attempts.saturating_add(1) >= MAX_CLEANUP_ATTEMPTS {
            Self::GaveUp
        } else {
            Self::DeleteFailed
        }
    }
}

/// What a session changed, each kind by its own measure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Work {
    /// A suggestions session's feed changes: suggestions it added, brought
    /// back, rewrote, retired or gave a draft.
    FeedChanges(u32),
    /// A routines session's routine suggestions suggested and kept;
    /// retirements don't count.
    RoutinesSuggested(u32),
}

impl Work {
    /// How many.
    pub fn count(self) -> u32 {
        match self {
            Self::FeedChanges(count) | Self::RoutinesSuggested(count) => count,
        }
    }

    /// Whether it changed anything.
    pub fn any(self) -> bool {
        self.count() > 0
    }
}
