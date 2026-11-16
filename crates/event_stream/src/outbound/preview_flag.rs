//! [`PreviewFlag`] over the backend feature flags (`public-event-stream`).

use crate::domain::ports::PreviewFlag;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The rollout flag for cursors, replay, the catalog, wildcards and preview
/// events.
pub const PUBLIC_EVENT_STREAM_FLAG: &str = "public-event-stream";

/// How long one user's evaluation is reused. Webhook ingestion evaluates per
/// matched webhook owner, so this bounds flag loads per event.
const CACHE_TTL: Duration = Duration::from_secs(60);

/// Evaluates [`PUBLIC_EVENT_STREAM_FLAG`] per user, cached briefly. A failed
/// evaluation reads `false` (and is not cached).
pub struct FeatureFlagPreview<F> {
    flags: F,
    cache: Arc<Mutex<HashMap<String, (bool, Instant)>>>,
}

impl<F> FeatureFlagPreview<F> {
    /// Evaluate through `flags`.
    pub fn new(flags: F) -> Self {
        Self {
            flags,
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl<F: FeatureFlags + 'static> PreviewFlag for FeatureFlagPreview<F> {
    async fn enabled_for(&self, user: &MacroUserIdStr<'static>) -> bool {
        let key = user.as_ref().to_owned();
        if let Some((enabled, at)) = self
            .cache
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .get(&key)
            && at.elapsed() < CACHE_TTL
        {
            return *enabled;
        }
        match self.flags.load(user).await {
            Ok(snapshot) => {
                let enabled = snapshot.is_enabled(PUBLIC_EVENT_STREAM_FLAG);
                let mut cache = self
                    .cache
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner());
                cache.retain(|_, (_, at)| at.elapsed() < CACHE_TTL);
                cache.insert(key, (enabled, Instant::now()));
                enabled
            }
            Err(error) => {
                tracing::warn!(error = ?error, "failed to evaluate the public-event-stream flag; treating it as off");
                false
            }
        }
    }
}
