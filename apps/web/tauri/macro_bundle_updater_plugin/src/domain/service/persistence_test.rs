use super::{
    BundleRoot, BundleSource,
    tests::{
        FakeFs, cache_dir, clear_required_status, seed_bundle, seed_persisted_bundle_root,
        service_with_status_and_fs,
    },
};

#[tokio::test]
async fn failed_bundle_root_persistence_preserves_active_bundle_state() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let active_dir = seed_bundle(&fs, &cache_dir, "1", 20, 0);
    let persisted_root = cache_dir.join("bundle_root");
    seed_persisted_bundle_root(&fs, &cache_dir, &active_dir);
    fs.fail_remove_file(&persisted_root);
    let (mut service, _start_rx) = service_with_status_and_fs(clear_required_status(), fs.clone());
    service.bundle_root = BundleRoot::from_path(active_dir.clone());
    service
        .bundle_routes
        .restore(BundleSource::ota(20, active_dir.clone()))
        .await;

    assert!(service.apply_update(&cache_dir).await.is_err());

    assert_eq!(service.bundle_root_path(), Some(active_dir.as_path()));
    assert_eq!(
        service.bundle_routes.active_identity().await,
        BundleSource::ota(20, active_dir).identity()
    );
    assert!(fs.file_exists(persisted_root));
    assert_eq!(service.pending_reload_bundle_build, None);
}
