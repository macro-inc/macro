use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::ScheduledCallResumeGate;

const ENABLE_SCHEDULED_CALL_RESUME: &str = "enable-scheduled-call-resume";

/// Evaluates the server-side resume switch for a meeting's owner.
pub struct FlaggedScheduledCallResume<F>(pub F);

#[async_trait::async_trait]
impl<F: FeatureFlags + Send + Sync + 'static> ScheduledCallResumeGate
    for FlaggedScheduledCallResume<F>
{
    async fn enabled_for(&self, meeting_owner: MacroUserIdStr<'_>) -> bool {
        match self.0.load(&meeting_owner).await {
            Ok(flags) => flags.is_enabled(ENABLE_SCHEDULED_CALL_RESUME),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load scheduled call resume flag");
                false
            }
        }
    }
}

/// Resumes every scheduled meeting, for local stacks without remote flags.
pub struct AlwaysResumeScheduledCalls;

#[async_trait::async_trait]
impl ScheduledCallResumeGate for AlwaysResumeScheduledCalls {
    async fn enabled_for(&self, _meeting_owner: MacroUserIdStr<'_>) -> bool {
        true
    }
}
