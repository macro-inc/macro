use super::{
    ApplyUpdateResult, BundleSource, ENTRYPOINT_NAME, PENDING_BUNDLE_ROOT_FILE, StartupSelection,
    UpdateStatus,
    tests::{
        FakeFs, cache_dir, seed_bundle, seed_pending_bundle_root, seed_persisted_bundle_root,
        service_with_status_fs_and_embedded_build,
    },
};
use crate::domain::{
    ports::{AutoUpdateService, FsRepo},
    startup::BundleRejection,
};

// The desktop app downloads the deployed bundle just before restarting into a
// native update. The new binary rejects the bundle the old one ran, which is
// older than its embedded bundle, and must still start on that download.
#[tokio::test]
async fn pending_download_survives_rejection_of_older_saved_bundle() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let saved = seed_bundle(&fs, &cache_dir, "1", 10, 0);
    seed_persisted_bundle_root(&fs, &cache_dir, &saved);
    seed_bundle(&fs, &cache_dir, "2", 15, 0);
    let staged = seed_bundle(&fs, &cache_dir, "3", 30, 0);
    seed_pending_bundle_root(&fs, &cache_dir, &staged);
    let (mut service, _start_rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 20);

    let startup = service.load_bundle_root(&cache_dir, 0).await;

    assert_eq!(startup.selection, StartupSelection::CompletedDownload);
    assert_eq!(startup.rejection, Some(BundleRejection::OlderThanEmbedded));
    assert_eq!(startup.bundle_dirs_removed, 2);
    assert!(!fs.dir_exists(&saved));
    assert!(!fs.dir_exists(cache_dir.join("2")));
    assert!(fs.dir_exists(&staged));
    assert_eq!(
        fs.read_to_string(&cache_dir.join("bundle_root"))
            .await
            .unwrap(),
        "embedded"
    );
    let UpdateStatus::Completed(completed) = service.status().borrow().as_ref().unwrap().clone()
    else {
        panic!("expected completed status");
    };
    assert_eq!(completed.bundle_build, 30);
    assert_eq!(completed.entrypoint, staged.join(ENTRYPOINT_NAME));

    assert_eq!(
        service.apply_update(&cache_dir).await.unwrap(),
        ApplyUpdateResult::ReloadNeeded
    );
    assert_eq!(service.bundle_root_path(), Some(staged.as_path()));
}

#[tokio::test]
async fn unusable_pending_download_is_removed_with_rejected_saved_bundle() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let saved = seed_bundle(&fs, &cache_dir, "1", 10, 0);
    seed_persisted_bundle_root(&fs, &cache_dir, &saved);
    let staged = seed_bundle(&fs, &cache_dir, "2", 30, 200);
    seed_pending_bundle_root(&fs, &cache_dir, &staged);
    let (mut service, _start_rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 20);

    let startup = service.load_bundle_root(&cache_dir, 100).await;

    assert_eq!(startup.selection, StartupSelection::Embedded);
    assert!(!fs.dir_exists(&saved));
    assert!(!fs.dir_exists(&staged));
    assert!(!fs.file_exists(cache_dir.join(PENDING_BUNDLE_ROOT_FILE)));
    assert!(matches!(
        service.status().borrow().as_ref().unwrap(),
        UpdateStatus::Idle
    ));
}

#[tokio::test]
async fn pending_download_newer_than_saved_bundle_is_started_on() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let saved = seed_bundle(&fs, &cache_dir, "1", 25, 0);
    seed_persisted_bundle_root(&fs, &cache_dir, &saved);
    let staged = seed_bundle(&fs, &cache_dir, "2", 30, 0);
    seed_pending_bundle_root(&fs, &cache_dir, &staged);
    let (mut service, _start_rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 20);

    let startup = service.load_bundle_root(&cache_dir, 0).await;

    assert_eq!(startup.selection, StartupSelection::CompletedDownload);
    assert_eq!(startup.rejection, None);
    assert!(fs.dir_exists(&saved));
    // Until the download is applied, requests still go to the saved bundle.
    assert_eq!(
        service.bundle_routes.active_identity().await,
        BundleSource::ota(25, saved).identity()
    );
    assert!(matches!(
        service.status().borrow().as_ref().unwrap(),
        UpdateStatus::Completed(completed) if completed.entrypoint == staged.join(ENTRYPOINT_NAME)
    ));
}

#[tokio::test]
async fn pending_download_no_newer_than_saved_bundle_is_dropped() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let saved = seed_bundle(&fs, &cache_dir, "1", 30, 0);
    seed_persisted_bundle_root(&fs, &cache_dir, &saved);
    let staged = seed_bundle(&fs, &cache_dir, "2", 30, 0);
    seed_pending_bundle_root(&fs, &cache_dir, &staged);
    let (mut service, _start_rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 20);

    let startup = service.load_bundle_root(&cache_dir, 0).await;

    assert_eq!(startup.selection, StartupSelection::SavedOta);
    assert_eq!(service.bundle_root_path(), Some(saved.as_path()));
    assert!(!fs.file_exists(cache_dir.join(PENDING_BUNDLE_ROOT_FILE)));
    assert!(matches!(
        service.status().borrow().as_ref().unwrap(),
        UpdateStatus::Idle
    ));
}
