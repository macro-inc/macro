use super::{
    ApplyUpdateResult, BundleRoot, BundleSource, UpdateStatus,
    tests::{
        FakeFs, cache_dir, clear_required_status, seed_bundle, seed_pending_bundle_root,
        seed_persisted_bundle_root, service_with_status_and_fs,
    },
};
use crate::domain::ports::{AutoUpdateService, FsRepo};

#[tokio::test]
async fn rollback_interrupted_before_reload_ack_does_not_restore_retired_bundles() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let active = seed_bundle(&fs, &cache_dir, "1", 101, 0);
    seed_bundle(&fs, &cache_dir, "2", 102, 0);
    seed_persisted_bundle_root(&fs, &cache_dir, &active);
    let (mut service, _rx) = service_with_status_and_fs(clear_required_status(), fs.clone());
    service.bundle_root = BundleRoot::from_path(active.clone());
    service
        .bundle_routes
        .restore(BundleSource::ota(101, active))
        .await;

    assert_eq!(
        service.apply_update(&cache_dir).await.unwrap(),
        ApplyUpdateResult::ReloadNeeded
    );
    assert!(fs.dir_exists(cache_dir.join("1")));
    assert!(fs.dir_exists(cache_dir.join("2")));
    assert_eq!(
        fs.read_to_string(&cache_dir.join("bundle_root"))
            .await
            .unwrap(),
        "embedded"
    );

    // No acknowledgement: model quitting or crashing during the live reload.
    drop(service);
    let (mut restarted, _rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());
    assert!(!restarted.load_bundle_root(&cache_dir, 0).await);
    assert_eq!(restarted.bundle_build().await, None);
    assert!(matches!(
        restarted.status().borrow().as_ref().unwrap(),
        UpdateStatus::Idle
    ));
    assert!(!fs.dir_exists(cache_dir.join("1")));
    assert!(!fs.dir_exists(cache_dir.join("2")));
}

#[tokio::test]
async fn an_explicit_embedded_selection_can_restore_a_later_pending_download() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    BundleRoot::Embedded.persist(&cache_dir, &fs).await.unwrap();
    seed_bundle(&fs, &cache_dir, "1", 101, 0);
    let pending = seed_bundle(&fs, &cache_dir, "2", 102, 0);
    seed_pending_bundle_root(&fs, &cache_dir, &pending);
    let (mut service, _rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());

    assert!(service.load_bundle_root(&cache_dir, 0).await);
    assert_eq!(
        service.apply_update(&cache_dir).await.unwrap(),
        ApplyUpdateResult::ReloadNeeded
    );
    assert_eq!(service.bundle_build().await, Some(102));
    assert_eq!(
        fs.read_to_string(&cache_dir.join("bundle_root"))
            .await
            .unwrap(),
        pending.to_string_lossy()
    );
}
