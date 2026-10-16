use super::{
    FsRepo, UpdateStatus, find_cached_bundle,
    tests::{
        FakeFs, cache_dir, seed_bundle, seed_persisted_bundle_root, service_with_status_and_fs,
    },
};

#[tokio::test]
async fn process_death_during_extraction_never_restores_or_reuses_partial_assets() {
    let fs = FakeFs::default();
    let cache = cache_dir();
    let dir = seed_bundle(&fs, &cache, "1", 20, 0);
    // Manifest and entrypoint can arrive before the JavaScript/assets.
    fs.remove_file(&dir.with_extension("complete"))
        .await
        .unwrap();
    assert!(find_cached_bundle(&fs, &cache, 20, 0).await.is_none());
    let (mut service, _rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());
    assert!(!service.load_bundle_root(&cache, 0).await);
    assert!(service.bundle_root_path().is_none());
}

#[tokio::test]
async fn torn_completion_record_and_evicted_entrypoint_fall_back_to_embedded() {
    for missing_entrypoint in [false, true] {
        let fs = FakeFs::default();
        let cache = cache_dir();
        let dir = seed_bundle(&fs, &cache, "1", 20, 0);
        seed_persisted_bundle_root(&fs, &cache, &dir);
        if missing_entrypoint {
            fs.remove_file(&dir.join("index.html")).await.unwrap();
        } else {
            fs.write_file(dir.with_extension("complete"), "2");
        }
        let (mut service, _rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());
        assert!(!service.load_bundle_root(&cache, 0).await);
        assert!(service.bundle_root_path().is_none());
    }
}
