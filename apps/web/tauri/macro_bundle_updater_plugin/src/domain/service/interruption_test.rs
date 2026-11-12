use super::{
    BundleRejection, BundleStartup, FsRepo, StartupSelection, UpdateStatus, find_cached_bundle,
    tests::{
        FakeFs, cache_dir, seed_bundle, seed_persisted_bundle_root, service_with_status_and_fs,
    },
};
use crate::domain::startup::SavedSelection;

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
    assert_eq!(
        service.load_bundle_root(&cache, 0).await.selection,
        StartupSelection::Embedded
    );
    assert!(service.bundle_root_path().is_none());
}

#[tokio::test]
async fn torn_completion_record_and_evicted_entrypoint_fall_back_to_embedded() {
    let evicted_entrypoint = BundleStartup {
        selection: StartupSelection::Embedded,
        saved_selection: SavedSelection::Ota,
        rejection: Some(BundleRejection::EntrypointUnreadable),
        read_error: Some("NotFound".to_string()),
        bundle_dirs_found: 1,
        bundle_dirs_removed: 0,
    };
    let torn_completion_record = BundleStartup {
        selection: StartupSelection::Embedded,
        saved_selection: SavedSelection::Ota,
        rejection: Some(BundleRejection::ExtractionIncomplete),
        read_error: None,
        bundle_dirs_found: 1,
        bundle_dirs_removed: 1,
    };
    for (missing_entrypoint, expected) in
        [(false, torn_completion_record), (true, evicted_entrypoint)]
    {
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
        assert_eq!(service.load_bundle_root(&cache, 0).await, expected);
        assert!(service.bundle_root_path().is_none());
    }
}
