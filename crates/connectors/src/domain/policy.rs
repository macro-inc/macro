//! The one reader of the Macro Connect rollout flag.
//!
//! This is the only Rust file that names the flag. Every answer goes through
//! one per-user cache, held by the one [`MacroConnectFlag`] each process
//! builds in `composition`; a failed read is an error, which the resolver
//! counts as off (rule 9).

use crate::domain::ports::ConnectFlag;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(test)]
mod test;

/// The PostHog flag that puts a user on Macro Connect. The web reads the
/// same key.
const MACRO_CONNECT_FLAG: &str = "macro-connect";

/// How long one user's answer is reused: every resolution asks.
const CACHE_TTL: Duration = Duration::from_secs(60);

/// The `macro-connect` flag, read through a per-user cache.
pub(crate) struct MacroConnectFlag<F> {
    /// `None` in a deployment without a flag provider: nobody is flagged.
    flags: Option<F>,
    /// Each user's last successful answer and when it was read. Failed reads
    /// are not cached, so the next resolution tries again.
    cache: Mutex<HashMap<MacroUserIdStr<'static>, (bool, Instant)>>,
}

impl<F: FeatureFlags + 'static> MacroConnectFlag<F> {
    /// Read the flag from `flags`, or answer off for everyone without one.
    pub(crate) fn new(flags: Option<F>) -> Self {
        Self {
            flags,
            cache: Mutex::default(),
        }
    }

    fn cached(&self, user: &MacroUserIdStr<'static>) -> Option<bool> {
        let cache = self.cache.lock().ok()?;
        let (on, read_at) = cache.get(user)?;

        (read_at.elapsed() < CACHE_TTL).then_some(*on)
    }

    fn remember(&self, user: &MacroUserIdStr<'static>, on: bool) {
        let Ok(mut cache) = self.cache.lock() else {
            return;
        };

        cache.retain(|_, (_, read_at)| read_at.elapsed() < CACHE_TTL);
        cache.insert(user.clone(), (on, Instant::now()));
    }
}

impl<F: FeatureFlags + 'static> ConnectFlag for MacroConnectFlag<F> {
    async fn read(&self, user: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report> {
        let Some(flags) = &self.flags else {
            return Ok(false);
        };
        if let Some(on) = self.cached(user) {
            return Ok(on);
        }

        let on = flags.load(user).await?.is_enabled(MACRO_CONNECT_FLAG);
        self.remember(user, on);

        Ok(on)
    }
}
