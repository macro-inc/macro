use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting {
    calls: AtomicUsize,
    mode: ToolMode,
}

impl ToolModeSelector for Counting {
    fn select<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = ToolMode> + Send + 'a>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { self.mode })
    }
}

#[tokio::test(start_paused = true)]
async fn reuses_a_users_mode_until_it_expires() {
    let inner = Arc::new(Counting {
        calls: AtomicUsize::new(0),
        mode: ToolMode::Code,
    });
    let cache = CachedToolMode::new(inner.clone());
    let user = MacroUserIdStr::parse_from_str("macro|fixture@example.com").unwrap();
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap();

    assert_eq!(cache.select(&user).await, ToolMode::Code);
    assert_eq!(cache.select(&user).await, ToolMode::Code);
    assert_eq!(inner.calls.load(Ordering::SeqCst), 1);

    cache.select(&other).await;
    assert_eq!(inner.calls.load(Ordering::SeqCst), 2);

    tokio::time::advance(TTL).await;
    cache.select(&user).await;
    assert_eq!(inner.calls.load(Ordering::SeqCst), 3);
}
