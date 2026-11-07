use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::ProgrammaticCallGate;

const ENABLE_PROGRAMMATIC_CALLS: &str = "enable-programmatic-calls";

/// Evaluates the server-side call switch for each authenticated account.
pub struct FlaggedProgrammaticCalls<F>(pub F);

#[async_trait::async_trait]
impl<F: FeatureFlags + Send + Sync + 'static> ProgrammaticCallGate for FlaggedProgrammaticCalls<F> {
    async fn enabled_for(&self, caller: MacroUserIdStr<'_>) -> bool {
        match self.0.load(&caller).await {
            Ok(flags) => flags.is_enabled(ENABLE_PROGRAMMATIC_CALLS),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load programmatic call flag");
                false
            }
        }
    }
}
