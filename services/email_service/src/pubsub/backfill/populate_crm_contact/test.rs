use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::time::Duration;

#[tokio::test]
async fn reuses_cached_team_membership() {
    let cache = TtlCache::new(10, Duration::from_secs(60));
    let team_id = Uuid::new_v4();
    let loads = AtomicUsize::new(0);

    for _ in 0..2 {
        let loaded = load_team_id(&cache, "user@example.com".to_owned(), || async {
            loads.fetch_add(1, Ordering::SeqCst);
            Ok(Some(team_id))
        })
        .await
        .unwrap();
        assert_eq!(loaded, Some(team_id));
    }

    assert_eq!(loads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn caches_users_without_a_team() {
    let cache = TtlCache::new(10, Duration::from_secs(60));
    let loads = AtomicUsize::new(0);

    for _ in 0..2 {
        let loaded = load_team_id(&cache, "user@example.com".to_owned(), || async {
            loads.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        })
        .await
        .unwrap();
        assert_eq!(loaded, None);
    }

    assert_eq!(loads.load(Ordering::SeqCst), 1);
}
