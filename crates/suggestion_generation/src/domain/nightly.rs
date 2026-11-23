//! What the nightly tick does with each person due a run, and when they are
//! due next.
//!
//! ```text
//! due ─┬─ not seen this week ──────────────▶ drop  (out of the rotation)
//!      ├─ their night is over ─────────────▶ miss  (next night)
//!      ├─ no room in this process ─────────▶ wait  (stays due)
//!      ├─ unpaid ──────────────────────────▶ drop
//!      ├─ plan unknown ────────────────────▶ retry (in NIGHTLY_RETRY)
//!      └─ paid ────────────────────────────▶ start ─┬─ started ─▶ next night
//!                                                   ├─ nothing to start ─▶ next night
//!                                                   └─ failed to start ─▶ retry
//! ```
//!
//! A started run cut short (cancelled or interrupted) makes its person due
//! again at once, for the next attempt.

use chrono::{DateTime, TimeDelta, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::model::AudienceMember;
use super::night;

#[cfg(test)]
mod test;

/// Who counts as active for a nightly run: seen in the last week.
pub const ACTIVE_WITHIN: TimeDelta = TimeDelta::days(7);
/// How long after a failed read or start a person is due again.
pub const NIGHTLY_RETRY: TimeDelta = TimeDelta::minutes(15);

/// Whether a person is on a paid plan, as far as it can be told.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumIter)]
pub enum Plan {
    /// On a paid plan.
    Paid,
    /// On none.
    Unpaid,
    /// It couldn't be read.
    Unknown,
}

/// What the tick does with one person due a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumIter)]
pub enum NightlyDecision {
    /// Start their run.
    Start,
    /// No room in this process: they stay due, and the tick stops.
    Wait,
    /// Their night ended before there was room: the next night.
    Miss,
    /// Not seen this week, or not on a paid plan: out of the rotation until
    /// seen again.
    Drop,
    /// Their plan couldn't be read: try again soon.
    Retry,
}

/// Whether deciding about `member` at `now`, with `room` runs free, needs
/// their plan: only when it would start their run.
pub fn needs_plan(member: &AudienceMember, now: DateTime<Utc>, room: usize) -> bool {
    active(member, now) && night::in_night(member.timezone, now) && room > 0
}

/// What to do with `member`, due a run, at `now` with `room` runs free in
/// this process and their `plan`, read only when [`needs_plan`] says so
/// (`None`: not read).
pub fn decide(
    member: &AudienceMember,
    now: DateTime<Utc>,
    room: usize,
    plan: Option<Plan>,
) -> NightlyDecision {
    if !active(member, now) {
        return NightlyDecision::Drop;
    }
    if !night::in_night(member.timezone, now) {
        return NightlyDecision::Miss;
    }
    if room == 0 {
        return NightlyDecision::Wait;
    }
    match plan {
        Some(Plan::Paid) => NightlyDecision::Start,
        Some(Plan::Unpaid) => NightlyDecision::Drop,
        Some(Plan::Unknown) | None => NightlyDecision::Retry,
    }
}

fn active(member: &AudienceMember, now: DateTime<Utc>) -> bool {
    member.seen_at > now - ACTIVE_WITHIN
}

/// What became of a person due a nightly run, as their row keeps it.
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
pub enum NightlyOutcome {
    /// Their run started.
    Started,
    /// Nothing started: their kinds are off, nothing is due, or a run
    /// already ran tonight.
    Skipped,
    /// Their night ended before there was room.
    Missed,
    /// Their plan couldn't be read, or their run couldn't be started.
    Retrying,
    /// Their run was cancelled or interrupted.
    CutShort,
    /// Out of the rotation: not seen this week, or not on a paid plan.
    Dropped,
}

impl NightlyOutcome {
    /// When `user`, in `timezone`, is next due after this outcome at `now`;
    /// none takes them out of the rotation until they are seen again.
    pub fn next_run(
        self,
        user: &MacroUserIdStr<'_>,
        timezone: chrono_tz::Tz,
        now: DateTime<Utc>,
    ) -> Option<DateTime<Utc>> {
        match self {
            Self::Started | Self::Skipped | Self::Missed => {
                Some(night::following(user, timezone, now))
            }
            Self::Retrying => Some(now + NIGHTLY_RETRY),
            Self::CutShort => Some(now),
            Self::Dropped => None,
        }
    }
}
