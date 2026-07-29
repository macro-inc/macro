use std::path::{Path, PathBuf};

use super::{ApplyUpdateResult, CompletedStatus, UpdateStatus, tests::service_with_status};

#[tokio::test]
async fn stale_document_cannot_acknowledge_a_new_bundle_generation() {
    let (mut service, mut start_rx) =
        service_with_status(UpdateStatus::Completed(CompletedStatus {
            bundle_build: 2,
            entrypoint: PathBuf::from("/cache/2/index.html"),
        }));
    assert_eq!(
        service.apply_update(Path::new("/cache")).await.unwrap(),
        ApplyUpdateResult::ReloadNeeded
    );

    let acknowledged = service
        .acknowledge_update_reload(Path::new("/cache"), 1)
        .await
        .unwrap();

    assert!(!acknowledged);
    assert_eq!(service.pending_reload_bundle_build, Some(2));
    assert!(start_rx.try_recv().is_err());
    let routes = service.bundle_routes.read().await;
    assert_eq!(routes.active.identity().bundle_build, 2);
    assert_eq!(
        routes
            .fallback
            .as_ref()
            .map(|source| source.identity().bundle_build),
        Some(0)
    );
}
