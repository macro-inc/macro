//! Gates channel threads on a per-caller flag and creates their roots through
//! the message service.
use std::sync::{Arc, OnceLock};

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::api::CallRootPoster;
use uuid::Uuid;

use crate::domain::ports::ChannelThreads;

/// PostHog flag naming who gets a channel thread when they start a channel call.
const ENABLE_CALL_CHANNEL_THREAD: &str = "enable-call-channel-thread";

/// The message service is built after the call service it sends to, so its
/// composition root fills this in once both exist.
pub type LateCallRootPoster = Arc<OnceLock<Arc<dyn CallRootPoster>>>;

/// [`ChannelThreads`] over a feature flag and the message service.
pub struct FlaggedChannelThreads<F> {
    flags: F,
    roots: LateCallRootPoster,
}

impl<F> FlaggedChannelThreads<F> {
    /// Compose the flag source with the message service it will send to.
    pub fn new(flags: F, roots: LateCallRootPoster) -> Self {
        Self { flags, roots }
    }
}

#[async_trait::async_trait]
impl<F: FeatureFlags + 'static> ChannelThreads for FlaggedChannelThreads<F> {
    async fn enabled_for(&self, caller: MacroUserIdStr<'_>) -> bool {
        match self.flags.load(&caller).await {
            Ok(flags) => flags.is_enabled(ENABLE_CALL_CHANNEL_THREAD),
            Err(error) => {
                tracing::warn!(
                    error = ?error,
                    "failed to load call flags; this call keeps its own chat"
                );
                false
            }
        }
    }

    async fn ensure_root(&self, call_id: Uuid) -> Result<(), rootcause::Report> {
        let roots = self
            .roots
            .get()
            .ok_or_else(|| rootcause::report!("the message service is not ready"))?;
        roots
            .ensure_call_root(call_id)
            .await
            .map_err(|error| rootcause::report!("failed to create the call root: {error}"))
    }
}
