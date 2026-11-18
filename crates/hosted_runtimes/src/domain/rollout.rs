//! Fail-closed, per-user rollout for new computer surfaces.

use std::{future::Future, pin::Pin, sync::Arc};

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

/// Shared web and backend rollout key.
pub const ENABLE_MACRO_COMPUTERS: &str = "enable-macro-computers";

type Evaluate =
    dyn Fn(MacroUserIdStr<'static>) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync;

/// Missing providers, failed evaluations and missing flags all disable rollout.
#[derive(Clone, Default)]
pub struct ComputerRollout {
    evaluate: Option<Arc<Evaluate>>,
}

impl ComputerRollout {
    /// Compose once with the service's bounded feature-flag provider.
    pub fn new<Flags: FeatureFlags + 'static>(flags: Flags) -> Self {
        let flags = Arc::new(flags);
        Self {
            evaluate: Some(Arc::new(move |user| {
                let flags = Arc::clone(&flags);
                Box::pin(async move {
                    flags
                        .load(&user)
                        .await
                        .inspect_err(|error| {
                            tracing::warn!(?error, "computer rollout unavailable; refusing access");
                        })
                        .unwrap_or_default()
                        .is_enabled(ENABLE_MACRO_COMPUTERS)
                })
            })),
        }
    }

    /// Evaluate the authenticated Macro user, never a team or derived identity.
    #[tracing::instrument(skip_all)]
    pub async fn enabled(&self, user_id: &MacroUserIdStr<'static>) -> bool {
        let Some(evaluate) = &self.evaluate else {
            return false;
        };
        evaluate(user_id.clone()).await
    }
}

#[cfg(test)]
mod test;
