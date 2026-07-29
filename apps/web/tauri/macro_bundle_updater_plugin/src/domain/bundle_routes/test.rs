use super::*;

#[tokio::test]
async fn starts_with_the_embedded_bundle() {
    let routes = BundleRoutes::new(42);

    let state = routes.read().await;

    assert_eq!(state.active, BundleSource::embedded(42));
    assert_eq!(state.fallback, None);
}

#[tokio::test]
async fn live_transition_retains_the_previous_source() {
    let routes = BundleRoutes::new(42);
    let ota = BundleSource::ota(43, PathBuf::from("/cache/43"));

    routes.transition_to(ota.clone()).await;
    let state = routes.read().await;

    assert_eq!(state.active, ota);
    assert_eq!(state.fallback, Some(BundleSource::embedded(42)));
}

#[tokio::test]
async fn startup_restore_does_not_retain_a_fallback() {
    let routes = BundleRoutes::new(42);
    routes
        .transition_to(BundleSource::ota(43, PathBuf::from("/cache/43")))
        .await;

    routes
        .restore(BundleSource::ota(44, PathBuf::from("/cache/44")))
        .await;
    let state = routes.read().await;

    assert_eq!(
        state.active,
        BundleSource::ota(44, PathBuf::from("/cache/44"))
    );
    assert_eq!(state.fallback, None);
}

#[tokio::test]
async fn finishing_transition_waits_for_existing_readers() {
    let routes = BundleRoutes::new(42);
    routes
        .transition_to(BundleSource::ota(43, PathBuf::from("/cache/43")))
        .await;
    let read_lease = routes.read().await;

    let task = tokio::spawn({
        let routes = routes.clone();
        async move { routes.finish_transition().await }
    });
    tokio::task::yield_now().await;

    assert!(!task.is_finished());
    drop(read_lease);
    assert_eq!(task.await.unwrap(), Some(BundleSource::embedded(42)));
}
