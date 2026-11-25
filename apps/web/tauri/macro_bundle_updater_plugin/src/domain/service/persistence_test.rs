use std::path::PathBuf;

use super::{
    ApplyUpdateResult, BundleRejection, BundleRoot, BundleSource, CompletedStatus,
    PENDING_BUNDLE_ROOT_FILE, StartupSelection, UpdateStatus,
    tests::{
        FakeFs, cache_dir, clear_required_status, seed_bundle, seed_persisted_bundle_root,
        service_with_status_and_fs,
    },
};
use crate::domain::ports::FsRepo;

#[tokio::test]
async fn failed_bundle_root_persistence_preserves_active_bundle_state() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let active_dir = seed_bundle(&fs, &cache_dir, "1", 20, 0);
    let persisted_root = cache_dir.join("bundle_root");
    seed_persisted_bundle_root(&fs, &cache_dir, &active_dir);
    fs.fail_write(&persisted_root);
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

#[tokio::test]
async fn saved_bundle_root_survives_ios_container_relocation() {
    let fs = FakeFs::default();
    let old_container = PathBuf::from(
        "/var/mobile/Containers/Data/Application/OLD-UUID/Library/Application Support/com.macro.app.prod/bundle-updates",
    );
    let new_container = PathBuf::from(
        "/var/mobile/Containers/Data/Application/NEW-UUID/Library/Application Support/com.macro.app.prod/bundle-updates",
    );
    let old_bundle = seed_bundle(&fs, &old_container, "1", 20, 0);
    let (mut writer, _rx) = service_with_status_and_fs(
        UpdateStatus::Completed(CompletedStatus {
            bundle_build: 20,
            entrypoint: old_bundle.join("index.html"),
        }),
        fs.clone(),
    );
    assert_eq!(
        writer.apply_update(&old_container).await.unwrap(),
        ApplyUpdateResult::ReloadNeeded
    );

    // Simulate iOS moving the app data container to a new UUID on App Store update.
    let persisted_marker = fs
        .read_to_string(&old_container.join("bundle_root"))
        .await
        .unwrap();
    let new_bundle = seed_bundle(&fs, &new_container, "1", 20, 0);
    fs.write_file(new_container.join("bundle_root"), &persisted_marker);
    fs.remove_file(&old_bundle.join("index.html"))
        .await
        .unwrap();

    let (mut restarted, _rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());
    let startup = restarted.load_bundle_root(&new_container, 202).await;

    assert_eq!(startup.selection, StartupSelection::SavedOta);
    assert_eq!(startup.rejection, None);
    assert_eq!(restarted.bundle_root_path(), Some(new_bundle.as_path()));
}

#[tokio::test]
async fn legacy_absolute_bundle_root_relocates_after_ios_container_move() {
    let fs = FakeFs::default();
    let old_bundle = PathBuf::from(
        "/var/mobile/Containers/Data/Application/OLD-UUID/Library/Application Support/com.macro.app.prod/bundle-updates/0",
    );
    let new_container = PathBuf::from(
        "/var/mobile/Containers/Data/Application/NEW-UUID/Library/Application Support/com.macro.app.prod/bundle-updates",
    );
    let new_bundle = seed_bundle(&fs, &new_container, "0", 42, 0);
    // Legacy iOS builds persisted the full absolute path from the old container UUID.
    fs.write_file(
        new_container.join("bundle_root"),
        old_bundle.to_string_lossy().as_ref(),
    );

    let (mut service, _rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());
    let startup = service.load_bundle_root(&new_container, 202).await;

    assert_eq!(startup.selection, StartupSelection::SavedOta);
    assert_eq!(startup.rejection, None);
    assert_eq!(service.bundle_root_path(), Some(new_bundle.as_path()));
    assert_eq!(
        fs.read_to_string(&new_container.join("bundle_root"))
            .await
            .unwrap(),
        "0"
    );
}

#[tokio::test]
async fn legacy_absolute_pending_bundle_root_relocates_after_ios_container_move() {
    let fs = FakeFs::default();
    let old_pending = PathBuf::from(
        "/var/mobile/Containers/Data/Application/OLD-UUID/Library/Application Support/com.macro.app.prod/bundle-updates/2",
    );
    let new_container = PathBuf::from(
        "/var/mobile/Containers/Data/Application/NEW-UUID/Library/Application Support/com.macro.app.prod/bundle-updates",
    );
    let new_bundle = seed_bundle(&fs, &new_container, "2", 55, 0);
    // Explicit embedded root + legacy absolute pending marker pointing at old container UUID.
    BundleRoot::Embedded
        .persist(&new_container, &fs)
        .await
        .unwrap();
    fs.write_file(
        new_container.join(PENDING_BUNDLE_ROOT_FILE),
        old_pending.to_string_lossy().as_ref(),
    );

    let (mut service, _rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());
    let startup = service.load_bundle_root(&new_container, 202).await;

    assert_eq!(startup.selection, StartupSelection::CompletedDownload);
    assert_eq!(
        service.apply_update(&new_container).await.unwrap(),
        ApplyUpdateResult::ReloadNeeded
    );
    assert_eq!(service.bundle_root_path(), Some(new_bundle.as_path()));
}

#[tokio::test]
async fn relative_bundle_root_rejects_path_traversal() {
    let fs = FakeFs::default();
    let cache = cache_dir();
    let escaped = cache.parent().unwrap().join("escape");
    fs.write_file(escaped.join("index.html"), "<html></html>");
    fs.write_file(cache.join("bundle_root"), "../escape");

    let (mut service, _rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());
    let startup = service.load_bundle_root(&cache, 202).await;

    assert_eq!(startup.selection, StartupSelection::Embedded);
    assert_eq!(
        startup.rejection,
        Some(BundleRejection::EntrypointUnreadable)
    );
    assert!(service.bundle_root_path().is_none());
}
