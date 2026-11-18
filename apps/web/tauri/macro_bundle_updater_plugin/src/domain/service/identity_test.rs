//! Bundles are ordered by the commit they were built from, never by when they
//! were built.

use super::{
    BundleRejection, StartupSelection, UpdateStatus,
    tests::{
        BUNDLE_GIT_SHA, FakeFs, cache_dir, commit_build, seed_bundle, seed_persisted_bundle_root,
        service_with_status_fs_and_embedded_build,
    },
};
use crate::domain::{ports::AutoUpdateService, startup::SavedSelection};

#[tokio::test]
async fn ota_of_the_embedded_commit_is_restored() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let bundle_dir = seed_bundle(&fs, &cache_dir, "1", 1794870406, 0);
    seed_persisted_bundle_root(&fs, &cache_dir, &bundle_dir);
    let (mut service, _rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs, commit_build(1794870406));

    let startup = service.load_bundle_root(&cache_dir, 0).await;

    assert_eq!(startup.selection, StartupSelection::SavedOta);
    assert_eq!(startup.rejection, None);
    assert_eq!(service.check_current_bundle(0).await, Ok(()));
    assert_eq!(service.bundle_build().await, Some(commit_build(1794870406)));
}

#[tokio::test]
async fn ota_of_an_older_commit_built_later_is_older_than_embedded() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let bundle_dir = seed_bundle(&fs, &cache_dir, "1", 1794870000, 0);
    // Rebuilt from the older commit after the embedded bundle's commit.
    fs.write_file(
        bundle_dir.join("bundle-manifest.json"),
        format!(
            r#"{{"schemaVersion":2,"bundleBuild":1794870000000,"commitTime":1794870000,"gitSha":"{BUNDLE_GIT_SHA}","builtAt":1794879999999,"minNativeBuild":0,"appVersion":"2.5.0"}}"#
        ),
    );
    seed_persisted_bundle_root(&fs, &cache_dir, &bundle_dir);
    let (mut service, _rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs, commit_build(1794870406));

    let startup = service.load_bundle_root(&cache_dir, 0).await;

    assert_eq!(startup.selection, StartupSelection::Embedded);
    assert_eq!(startup.rejection, Some(BundleRejection::OlderThanEmbedded));
    assert!(service.bundle_root_path().is_none());
}

#[tokio::test]
async fn completed_download_restore_picks_the_newest_commit() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let newest = seed_bundle(&fs, &cache_dir, "1", 1794870406, 0);
    // Downloaded later, into a later directory, but from an older commit.
    seed_bundle(&fs, &cache_dir, "2", 1794870300, 0);
    let (mut service, _rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs, commit_build(1794870000));

    let startup = service.load_bundle_root(&cache_dir, 0).await;

    assert_eq!(startup.selection, StartupSelection::CompletedDownload);
    let status = service.status().borrow().as_ref().unwrap().clone();
    let UpdateStatus::Completed(completed) = status else {
        panic!("expected a completed status, got {status:?}");
    };
    assert_eq!(completed.bundle_build, commit_build(1794870406));
    assert_eq!(completed.entrypoint, newest.join("index.html"));
}

#[tokio::test]
async fn legacy_unstamped_manifest_falls_back_to_embedded() {
    let fs = FakeFs::default();
    let cache_dir = cache_dir();
    let bundle_dir = seed_bundle(&fs, &cache_dir, "1", 1794870406, 0);
    fs.write_file(
        bundle_dir.join("bundle-manifest.json"),
        r#"{"schemaVersion":2,"bundleBuild":1794879999999,"minNativeBuild":0,"gitSha":"cd95980","appVersion":"2.5.0"}"#,
    );
    fs.write_file(bundle_dir.with_extension("complete"), "1794879999999");
    seed_persisted_bundle_root(&fs, &cache_dir, &bundle_dir);
    let (mut service, _rx) = service_with_status_fs_and_embedded_build(
        UpdateStatus::Idle,
        fs.clone(),
        commit_build(1794870000),
    );

    let startup = service.load_bundle_root(&cache_dir, 0).await;

    assert_eq!(startup.selection, StartupSelection::Embedded);
    assert_eq!(startup.saved_selection, SavedSelection::Ota);
    assert_eq!(startup.rejection, Some(BundleRejection::ManifestInvalid));
    assert!(service.bundle_root_path().is_none());
    assert_eq!(service.bundle_build().await, None);
    assert!(!fs.dir_exists(bundle_dir));
}
