//! Who may use event triggers, decided per routine owner by a PostHog flag.

use std::future::Future;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

#[cfg(test)]
mod test;

/// PostHog rollout shared with the web app's trigger menu.
pub const EVENT_ROUTINES_FLAG: &str = "enable-event-routines";

/// Whether a user may save event triggers and have them run.
pub trait EventRoutineRollout: Send + Sync + 'static {
    /// A failed flag load is an error; each caller decides its fallback.
    fn enabled_for(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// Composition without flags: event triggers are off for everyone.
#[derive(Debug, Clone, Copy, Default)]
pub struct EventRoutinesOff;

impl EventRoutineRollout for EventRoutinesOff {
    async fn enabled_for(&self, _user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        Ok(false)
    }
}

/// Reads [`EVENT_ROUTINES_FLAG`] for each owner.
#[derive(Debug, Clone)]
pub struct FlaggedEventRoutines<F>(F);

impl<F> FlaggedEventRoutines<F> {
    pub fn new(flags: F) -> Self {
        Self(flags)
    }
}

impl<F: FeatureFlags + 'static> EventRoutineRollout for FlaggedEventRoutines<F> {
    #[tracing::instrument(name = "routine.event_routines_flag", err, skip_all)]
    async fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        Ok(self.0.load(user).await?.is_enabled(EVENT_ROUTINES_FLAG))
    }
}

/// A deployment without a flag source keeps event triggers off.
impl<R: EventRoutineRollout> EventRoutineRollout for Option<R> {
    async fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        match self {
            Some(rollout) => rollout.enabled_for(user).await,
            None => Ok(false),
        }
    }
}
