use super::TtlCache;
use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Barrier;
use tokio::time::Duration;
use uuid::Uuid;

#[tokio::test]
async fn returns_cached_value_before_expiry() {
    let cache = TtlCache::new(10, Duration::from_secs(60));
    let loads = AtomicUsize::new(0);

    let first = cache
        .get_or_load("key", || async {
            loads.fetch_add(1, Ordering::SeqCst);
            Ok::<_, Infallible>(42)
        })
        .await
        .unwrap();
    let second = cache
        .get_or_load("key", || async {
            loads.fetch_add(1, Ordering::SeqCst);
            Ok::<_, Infallible>(99)
        })
        .await
        .unwrap();

    assert_eq!(first, 42);
    assert_eq!(second, 42);
    assert_eq!(loads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn reloads_expired_value() {
    let cache = TtlCache::new(10, Duration::from_millis(10));

    let first = cache
        .get_or_load("key", || async { Ok::<_, Infallible>(1) })
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    let second = cache
        .get_or_load("key", || async { Ok::<_, Infallible>(2) })
        .await
        .unwrap();

    assert_eq!(first, 1);
    assert_eq!(second, 2);
}

#[tokio::test]
async fn invalidation_forces_reload() {
    let cache = TtlCache::new(10, Duration::from_secs(60));

    cache
        .get_or_load("key", || async { Ok::<_, Infallible>(1) })
        .await
        .unwrap();
    cache.invalidate(&"key");
    let reloaded = cache
        .get_or_load("key", || async { Ok::<_, Infallible>(2) })
        .await
        .unwrap();

    assert_eq!(reloaded, 2);
}

#[tokio::test]
async fn caches_negative_results() {
    let cache = TtlCache::new(10, Duration::from_secs(60));
    let loads = AtomicUsize::new(0);

    for _ in 0..2 {
        let value = cache
            .get_or_load("user", || async {
                loads.fetch_add(1, Ordering::SeqCst);
                Ok::<_, Infallible>(None::<Uuid>)
            })
            .await
            .unwrap();
        assert_eq!(value, None);
    }

    assert_eq!(loads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn concurrent_misses_share_one_load() {
    const CALLERS: usize = 20;

    let cache = TtlCache::new(10, Duration::from_secs(60));
    let loads = Arc::new(AtomicUsize::new(0));
    let start = Arc::new(Barrier::new(CALLERS + 1));
    let mut tasks = Vec::with_capacity(CALLERS);

    for _ in 0..CALLERS {
        let cache = cache.clone();
        let loads = Arc::clone(&loads);
        let start = Arc::clone(&start);
        tasks.push(tokio::spawn(async move {
            start.wait().await;
            cache
                .get_or_load("key", || async move {
                    loads.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    Ok::<_, Infallible>(42)
                })
                .await
                .unwrap()
        }));
    }

    start.wait().await;
    for task in tasks {
        assert_eq!(task.await.unwrap(), 42);
    }
    assert_eq!(loads.load(Ordering::SeqCst), 1);
}
