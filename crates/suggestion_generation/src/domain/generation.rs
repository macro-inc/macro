//! A generation's lifecycle: its status, the events that end it, whether a
//! new one may start, and what the person's generations look like now.
//!
//! ```text
//!                 all sessions finished      ─▶ ready
//!                 some finished or changed   ─▶ partial
//! generating ──── none finished or changed   ─▶ failed
//!                 process stopped it         ─▶ cancelled   ┐ may start again
//!                 heartbeat lost (sweep)     ─▶ interrupted ┘ as the next attempt
//! ```
//!
//! Every status but `generating` is final. Storage writes a status only from
//! the statuses [`GenerationEvent::sources`] names.

use chrono::{DateTime, TimeDelta, Utc};
use serde::Serialize;
use strum::IntoEnumIterator as _;
use suggestions::domain::model::GenerationTrigger;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// Most attempts one generation gets: an attempt cut short (cancelled or
/// interrupted) may be followed by the next, with a new id, up to this many.
pub const MAX_ATTEMPTS: u8 = 3;
/// A person asks for fresh suggestions at most once in this long, counted
/// from their last manual start.
pub const REGENERATE_EVERY: TimeDelta = TimeDelta::hours(1);
/// Nightly runs at most once in this long, whatever the zone does.
pub const NIGHTLY_EVERY: TimeDelta = TimeDelta::hours(20);

/// Where a generation is.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    strum::EnumString,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::EnumIter,
    Serialize,
    ToSchema,
)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum GenerationStatus {
    /// Its sessions are running.
    Generating,
    /// Every session finished its turn.
    Ready,
    /// Not every session finished, but at least one finished or changed
    /// something.
    Partial,
    /// No session finished or changed anything.
    Failed,
    /// Its process stopped (a deploy) before any session finished.
    Cancelled,
    /// Its heartbeat stopped: its process died without recording an end.
    /// The sweep marks it.
    Interrupted,
}

/// What ends a running generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumIter)]
pub enum GenerationEvent {
    /// Every session finished its turn.
    AllFinished,
    /// Not every session finished, but at least one finished or changed
    /// something.
    SomeFinished,
    /// No session finished or changed anything.
    NoneFinished,
    /// Its process is stopping and cut its sessions short before any
    /// finished.
    ProcessStopped,
    /// Its heartbeat stopped for longer than the sweep allows.
    HeartbeatLost,
}

/// A transition the table doesn't have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a {from:?} generation can't take {event:?}")]
pub struct GenerationRefused {
    /// The status it was in.
    pub from: GenerationStatus,
    /// What was refused.
    pub event: GenerationEvent,
}

impl GenerationStatus {
    /// The status `event` moves a generation in this status to.
    pub fn on(self, event: GenerationEvent) -> Result<Self, GenerationRefused> {
        use GenerationEvent as Event;
        match (self, event) {
            (Self::Generating, Event::AllFinished) => Ok(Self::Ready),
            (Self::Generating, Event::SomeFinished) => Ok(Self::Partial),
            (Self::Generating, Event::NoneFinished) => Ok(Self::Failed),
            (Self::Generating, Event::ProcessStopped) => Ok(Self::Cancelled),
            (Self::Generating, Event::HeartbeatLost) => Ok(Self::Interrupted),
            (
                Self::Ready | Self::Partial | Self::Failed | Self::Cancelled | Self::Interrupted,
                _,
            ) => Err(GenerationRefused { from: self, event }),
        }
    }

    /// Whether its sessions are running.
    pub fn is_running(self) -> bool {
        self == Self::Generating
    }

    /// Whether a generation that ended so may start again as the next
    /// attempt: it was cut short, not judged.
    pub fn retryable(self) -> bool {
        matches!(self, Self::Cancelled | Self::Interrupted)
    }
}

impl GenerationEvent {
    /// The statuses this event may leave, as storage guards its write.
    pub fn sources(self) -> Vec<GenerationStatus> {
        GenerationStatus::iter()
            .filter(|status| status.on(self).is_ok())
            .collect()
    }

    /// The status this event enters.
    pub fn entered(self) -> GenerationStatus {
        match self {
            Self::AllFinished => GenerationStatus::Ready,
            Self::SomeFinished => GenerationStatus::Partial,
            Self::NoneFinished => GenerationStatus::Failed,
            Self::ProcessStopped => GenerationStatus::Cancelled,
            Self::HeartbeatLost => GenerationStatus::Interrupted,
        }
    }
}

/// How one session of a generation came out, as its end reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionResult {
    /// Whether it finished its turn.
    pub finished: bool,
    /// Whether it changed anything, by its kind's measure.
    pub changed: bool,
}

/// The event that ends a generation whose sessions came out as `sessions`,
/// with its process `stopping` or not.
pub fn conclude(sessions: &[SessionResult], stopping: bool) -> GenerationEvent {
    let finished = sessions.iter().filter(|session| session.finished).count();
    let changed = sessions.iter().any(|session| session.changed);
    if !sessions.is_empty() && finished == sessions.len() {
        GenerationEvent::AllFinished
    } else if stopping && finished == 0 {
        GenerationEvent::ProcessStopped
    } else if finished > 0 || changed {
        GenerationEvent::SomeFinished
    } else {
        GenerationEvent::NoneFinished
    }
}

/// The person's latest generation of one trigger, as admission reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PastRun {
    /// Where it is.
    pub status: GenerationStatus,
    /// Which attempt it was, from 1.
    pub attempt: u8,
    /// When it started.
    pub started_at: DateTime<Utc>,
}

/// Whether a generation may start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum Admission {
    /// Start attempt `attempt`.
    Start {
        /// From 1.
        attempt: u8,
    },
    /// One of the person's generations is running, of any trigger.
    Running,
    /// This trigger ran; it may run again at `available_at`.
    Cooldown {
        /// When it may run again.
        available_at: DateTime<Utc>,
    },
    /// This trigger ran and never runs again: onboarding.
    Done,
}

/// How long after a generation of `trigger` starts another may: none for
/// onboarding, which runs once.
pub fn window(trigger: GenerationTrigger) -> Option<TimeDelta> {
    match trigger {
        GenerationTrigger::Onboarding => None,
        GenerationTrigger::Nightly => Some(NIGHTLY_EVERY),
        GenerationTrigger::Manual => Some(REGENERATE_EVERY),
    }
}

/// Whether a generation of `trigger` may start at `now`, with one of the
/// person's `running` or not, after `latest`, their latest of `trigger`.
/// One ended cut short may start again as the next attempt, up to
/// [`MAX_ATTEMPTS`]; otherwise its trigger's [`window`] holds the next back.
/// An onboarding generation doesn't hold back a nightly one, nor a manual
/// one either: each trigger counts its own.
pub fn admit(
    trigger: GenerationTrigger,
    running: bool,
    latest: Option<PastRun>,
    now: DateTime<Utc>,
) -> Admission {
    if running {
        return Admission::Running;
    }
    let Some(latest) = latest else {
        return Admission::Start { attempt: 1 };
    };
    if latest.status.is_running() {
        return Admission::Running;
    }
    let available_at = window(trigger).map(|window| latest.started_at + window);
    if available_at.is_some_and(|at| at <= now) {
        return Admission::Start { attempt: 1 };
    }
    if latest.status.retryable() && latest.attempt < MAX_ATTEMPTS {
        return Admission::Start {
            attempt: latest.attempt + 1,
        };
    }
    match available_at {
        Some(available_at) => Admission::Cooldown { available_at },
        None => Admission::Done,
    }
}

/// Whether one of the person's generations is running.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GenerationState {
    /// None is running.
    Idle,
    /// One is running.
    Running,
}

/// What storage knows about the person's generations, for
/// [`GenerationOverview`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct OverviewFacts {
    /// The running one: its trigger and when it started.
    pub running: Option<(GenerationTrigger, DateTime<Utc>)>,
    /// The latest one that ended: how, and when.
    pub last_ended: Option<(GenerationStatus, DateTime<Utc>)>,
    /// The latest manual one.
    pub latest_manual: Option<PastRun>,
}

/// The person's generations now, for the web app to show and poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerationOverview {
    /// Whether one is running.
    pub state: GenerationState,
    /// The running one's trigger.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<GenerationTrigger>,
    /// When the running one started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    /// When the latest one that ended ended.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_finished_at: Option<DateTime<Utc>>,
    /// How the latest one that ended ended.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_outcome: Option<GenerationStatus>,
    /// When the person may next ask for fresh suggestions, while they may
    /// not; absent when they may (or must wait only for the running one).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub regenerate_available_at: Option<DateTime<Utc>>,
}

impl GenerationOverview {
    /// The overview `facts` make at `now`.
    pub fn new(facts: OverviewFacts, now: DateTime<Utc>) -> Self {
        let regenerate_available_at =
            match admit(GenerationTrigger::Manual, false, facts.latest_manual, now) {
                Admission::Cooldown { available_at } => Some(available_at),
                Admission::Start { .. } | Admission::Running | Admission::Done => None,
            };
        Self {
            state: if facts.running.is_some() {
                GenerationState::Running
            } else {
                GenerationState::Idle
            },
            trigger: facts.running.map(|(trigger, _)| trigger),
            started_at: facts.running.map(|(_, started_at)| started_at),
            last_finished_at: facts.last_ended.map(|(_, at)| at),
            last_outcome: facts.last_ended.map(|(status, _)| status),
            regenerate_available_at,
        }
    }
}
