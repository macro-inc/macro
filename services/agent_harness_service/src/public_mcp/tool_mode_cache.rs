//! Per-user tool mode, cached because every stateless MCP request asks for it.
use agent_inmem::domain::tool_mode::{ToolMode, ToolModeSelector};
use macro_user_id::user_id::MacroUserIdStr;
use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::time::Instant;

#[cfg(test)]
mod test;

/// How long a flag evaluation is reused; flag changes apply within this window.
const TTL: Duration = Duration::from_secs(60);
/// Expired entries are swept once the map grows past this size.
const SWEEP_AT: usize = 10_000;

/// Reuses each user's tool mode for [`TTL`] instead of loading flags per request.
pub struct CachedToolMode {
    inner: Arc<dyn ToolModeSelector>,
    cache: Mutex<HashMap<String, (Instant, ToolMode)>>,
}

impl CachedToolMode {
    pub fn new(inner: Arc<dyn ToolModeSelector>) -> Self {
        Self {
            inner,
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn cached(&self, user: &str) -> Option<ToolMode> {
        let cache = self.cache.lock().expect("tool mode cache is not poisoned");
        cache
            .get(user)
            .filter(|(at, _)| at.elapsed() < TTL)
            .map(|(_, mode)| *mode)
    }

    fn store(&self, user: &str, mode: ToolMode) {
        let mut cache = self.cache.lock().expect("tool mode cache is not poisoned");
        if cache.len() >= SWEEP_AT {
            cache.retain(|_, (at, _)| at.elapsed() < TTL);
        }
        cache.insert(user.to_owned(), (Instant::now(), mode));
    }
}

impl ToolModeSelector for CachedToolMode {
    fn select<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = ToolMode> + Send + 'a>> {
        Box::pin(async move {
            let key = owner.as_ref();
            if let Some(mode) = self.cached(key) {
                return mode;
            }
            let mode = self.inner.select(owner).await;
            self.store(key, mode);
            mode
        })
    }
}
