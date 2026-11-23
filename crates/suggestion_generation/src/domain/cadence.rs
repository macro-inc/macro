//! How often routine suggestions come: a generation includes a routines
//! session at onboarding, then once a week, counted from the last routines
//! session that finished and suggested something. One that failed, timed out
//! or suggested nothing leaves the next generation to try again.

use chrono::{DateTime, TimeDelta, Utc};
use suggestions::domain::model::GenerationTrigger;

use super::session::{SessionEnding, Work};

#[cfg(test)]
mod test;

/// How often a person's generations include a routines session: once a
/// week. Other nights run only the suggestions session.
pub const ROUTINES_EVERY: TimeDelta = TimeDelta::days(7);

/// Whether a generation of `trigger` at `now` includes a routines session,
/// the last good one having been at `last_ok`.
pub fn routines_due(
    trigger: GenerationTrigger,
    last_ok: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> bool {
    match trigger {
        GenerationTrigger::Onboarding => true,
        GenerationTrigger::Nightly | GenerationTrigger::Manual => {
            last_ok.is_none_or(|at| now - at >= ROUTINES_EVERY)
        }
    }
}

/// Whether a routines session that ended so counts as the week's: it
/// finished and suggested something.
pub fn routines_ok(ending: SessionEnding, work: Work) -> bool {
    ending == SessionEnding::Finished && matches!(work, Work::RoutinesSuggested(count) if count > 0)
}
