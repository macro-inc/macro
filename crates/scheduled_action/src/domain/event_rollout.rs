//! Who may use event triggers and sub-routines, decided per routine owner by
//! PostHog flags.

use std::future::Future;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

#[cfg(test)]
mod test;

/// PostHog rollout shared with the web app's trigger menu.
pub const EVENT_ROUTINES_FLAG: &str = "enable-event-routines";

/// PostHog rollout of routines that define sub-routines or hold inputs.
/// Turned on only once every service that reads a routine's task keeps
/// those fields (the web app, the harness and document storage).
pub const SUB_ROUTINES_FLAG: &str = "enable-sub-routines";

/// Whether a user may save event triggers and have them run, and save
/// routines that define sub-routines.
pub trait EventRoutineRollout: Send + Sync + 'static {
    /// A failed flag load is an error; each caller decides its fallback.
    fn enabled_for(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;

    /// Whether `user` may save a routine with sub-routines or inputs. A
    /// failed flag load is an error; each caller decides its fallback.
    fn sub_routines_enabled_for(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// Composition without flags: event triggers and sub-routines are off for
/// everyone.
#[derive(Debug, Clone, Copy, Default)]
pub struct EventRoutinesOff;

impl EventRoutineRollout for EventRoutinesOff {
    async fn enabled_for(&self, _user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        Ok(false)
    }

    async fn sub_routines_enabled_for(&self, _user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        Ok(false)
    }
}

/// Reads [`EVENT_ROUTINES_FLAG`] and [`SUB_ROUTINES_FLAG`] for each owner.
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

    #[tracing::instrument(name = "routine.sub_routines_flag", err, skip_all)]
    async fn sub_routines_enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        Ok(self.0.load(user).await?.is_enabled(SUB_ROUTINES_FLAG))
    }
}

/// A deployment without a flag source keeps event triggers and sub-routines
/// off.
impl<R: EventRoutineRollout> EventRoutineRollout for Option<R> {
    async fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        match self {
            Some(rollout) => rollout.enabled_for(user).await,
            None => Ok(false),
        }
    }

    async fn sub_routines_enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        match self {
            Some(rollout) => rollout.sub_routines_enabled_for(user).await,
            None => Ok(false),
        }
    }
}

/// Drafts define sub-routines only for owners who may save them.
#[async_trait::async_trait]
impl<R: EventRoutineRollout> super::ports::DraftSubRoutines for R {
    async fn may_define(&self, owner: &MacroUserIdStr<'static>) -> bool {
        self.sub_routines_enabled_for(owner)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    ?error,
                    "feature flags unavailable; drafts define no sub-routines"
                );
            })
            .unwrap_or(false)
    }
}
