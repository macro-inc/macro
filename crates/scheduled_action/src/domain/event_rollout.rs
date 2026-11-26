//! Who may use event triggers, decided per routine owner by a PostHog flag.

use std::future::Future;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

#[cfg(test)]
mod test;

/// PostHog rollout shared with the web app's trigger menu.
pub const EVENT_ROUTINES_FLAG: &str = "enable-event-routines";

/// PostHog rollout of the `email.labeled` trigger, on top of
/// [`EVENT_ROUTINES_FLAG`], shared with the web app's trigger menu.
pub const EMAIL_LABELED_FLAG: &str = "enable-email-labeled-trigger";

/// Whether a user may save event triggers and have them run.
pub trait EventRoutineRollout: Send + Sync + 'static {
    /// A failed flag load is an error; each caller decides its fallback.
    fn enabled_for(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;

    /// Whether a user may save `email.labeled` triggers and have them run.
    fn email_labels_enabled_for(
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

    async fn email_labels_enabled_for(&self, _user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        Ok(false)
    }
}

/// Reads [`EVENT_ROUTINES_FLAG`] and [`EMAIL_LABELED_FLAG`] for each owner.
#[derive(Debug, Clone)]
pub struct FlaggedEventRoutines<F> {
    flags: F,
    email_labels_without_flag: bool,
}

impl<F> FlaggedEventRoutines<F> {
    pub fn new(flags: F) -> Self {
        Self {
            flags,
            email_labels_without_flag: false,
        }
    }

    /// Whether `email.labeled` is on while PostHog has no such flag: in
    /// development, before the production rollout is set up.
    pub fn with_email_labels_without_flag(mut self, enabled: bool) -> Self {
        self.email_labels_without_flag = enabled;
        self
    }
}

impl<F: FeatureFlags + 'static> EventRoutineRollout for FlaggedEventRoutines<F> {
    #[tracing::instrument(name = "routine.event_routines_flag", err, skip_all)]
    async fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        Ok(self.flags.load(user).await?.is_enabled(EVENT_ROUTINES_FLAG))
    }

    #[tracing::instrument(name = "routine.email_labeled_flag", err, skip_all)]
    async fn email_labels_enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        let snapshot = self.flags.load(user).await?;
        Ok(match snapshot.get(EMAIL_LABELED_FLAG) {
            Some(_) => snapshot.is_enabled(EMAIL_LABELED_FLAG),
            None => self.email_labels_without_flag,
        })
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

    async fn email_labels_enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        match self {
            Some(rollout) => rollout.email_labels_enabled_for(user).await,
            None => Ok(false),
        }
    }
}
