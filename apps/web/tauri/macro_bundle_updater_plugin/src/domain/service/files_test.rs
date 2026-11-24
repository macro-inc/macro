use std::{io::ErrorKind, path::PathBuf};

use super::{
    BundleRejection, FsRepo, StartupSelection, UpdateStatus, find_cached_bundle,
    tests::{
        FakeFs, cache_dir, seed_bundle, seed_pending_bundle_root, seed_persisted_bundle_root,
        service_with_status_fs_and_embedded_build, unzip_status, worker_with_fs_and_native_build,
    },
};
use crate::domain::{
    completion::{BundleFile, CompletionRecord},
    startup::SavedSelection,
};

/// Seed bundle `1` (build 20) with a startup chunk and a completion record
/// listing every file, as a download made by this release writes it.
fn seed_listed_bundle(fs: &FakeFs) -> PathBuf {
    let dir = seed_bundle(fs, &cache_dir(), "1", 20, 0);
    fs.write_file(dir.join("assets/startup-1.js"), "console.log(1)");
    let record = CompletionRecord {
        bundle_build: 20,
        files: Some(vec![
            BundleFile {
                path: PathBuf::from("assets/startup-1.js"),
                size: 14,
            },
            BundleFile {
                path: PathBuf::from("bundle-manifest.json"),
                size: 92,
            },
            BundleFile {
                path: PathBuf::from("index.html"),
                size: 13,
            },
        ]),
    };
    fs.write_file(dir.with_extension("complete"), record.render());
    dir
}

#[tokio::test]
async fn saved_bundle_with_every_listed_file_is_served() {
    let fs = FakeFs::default();
    let dir = seed_listed_bundle(&fs);
    seed_persisted_bundle_root(&fs, &cache_dir(), &dir);
    let (mut service, _rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 10);

    let startup = service.load_bundle_root(&cache_dir(), 0).await;

    assert_eq!(startup.selection, StartupSelection::SavedOta);
    assert_eq!(startup.rejection, None);
    assert!(startup.saved_bundle_check_ms.is_some());
    assert_eq!(service.bundle_root_path(), Some(dir.as_path()));
}

#[tokio::test]
async fn saved_bundle_missing_a_listed_file_falls_back_to_embedded() {
    let fs = FakeFs::default();
    let dir = seed_listed_bundle(&fs);
    seed_persisted_bundle_root(&fs, &cache_dir(), &dir);
    // Storage cleanup removed a startup chunk but left index.html, so the
    // document would load and then fail to run any script.
    fs.remove_file(&dir.join("assets/startup-1.js"))
        .await
        .unwrap();
    let (mut service, _rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 10);

    let startup = service.load_bundle_root(&cache_dir(), 0).await;

    assert_eq!(startup.selection, StartupSelection::Embedded);
    assert_eq!(startup.saved_selection, SavedSelection::Ota);
    assert_eq!(startup.rejection, Some(BundleRejection::FilesMissing));
    assert_eq!(startup.read_error.as_deref(), Some("NotFound"));
    assert_eq!(startup.bundle_dirs_removed, 1);
    assert!(service.bundle_root_path().is_none());
    assert!(!fs.dir_exists(&dir));
    assert_eq!(
        fs.read_to_string(&cache_dir().join("bundle_root"))
            .await
            .unwrap(),
        "embedded"
    );
}

#[tokio::test]
async fn saved_bundle_with_a_truncated_file_falls_back_to_embedded() {
    let fs = FakeFs::default();
    let dir = seed_listed_bundle(&fs);
    seed_persisted_bundle_root(&fs, &cache_dir(), &dir);
    fs.write_file(dir.join("assets/startup-1.js"), "cons");
    let (mut service, _rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 10);

    let startup = service.load_bundle_root(&cache_dir(), 0).await;

    assert_eq!(startup.selection, StartupSelection::Embedded);
    assert_eq!(startup.rejection, Some(BundleRejection::FilesMissing));
    assert_eq!(startup.read_error, None);
}

#[tokio::test]
async fn unreadable_listed_file_reports_its_error_kind() {
    let fs = FakeFs::default();
    let dir = seed_listed_bundle(&fs);
    seed_persisted_bundle_root(&fs, &cache_dir(), &dir);
    fs.fail_read(dir.join("assets/startup-1.js"), ErrorKind::PermissionDenied);
    let (mut service, _rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 10);

    let startup = service.load_bundle_root(&cache_dir(), 0).await;

    assert_eq!(startup.rejection, Some(BundleRejection::FilesMissing));
    assert_eq!(startup.read_error.as_deref(), Some("PermissionDenied"));
}

#[tokio::test]
async fn completed_download_missing_a_listed_file_is_neither_applied_nor_reused() {
    let fs = FakeFs::default();
    let dir = seed_listed_bundle(&fs);
    seed_pending_bundle_root(&fs, &cache_dir(), &dir);
    fs.remove_file(&dir.join("assets/startup-1.js"))
        .await
        .unwrap();
    let (mut service, _rx) =
        service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 10);

    let startup = service.load_bundle_root(&cache_dir(), 0).await;

    assert_eq!(startup.selection, StartupSelection::Embedded);
    assert!(find_cached_bundle(&fs, &cache_dir(), 20, 0).await.is_none());
}

#[tokio::test]
async fn extraction_records_every_file_except_the_archive() {
    let fs = FakeFs::default();
    let cache = cache_dir();
    let dir = seed_bundle(&fs, &cache, "0", 40, 0);
    fs.write_file(dir.join("bundle.zip"), "zip bytes");
    fs.write_file(dir.join("assets/startup-1.js"), "console.log(1)");
    let mut worker = worker_with_fs_and_native_build(fs.clone(), None, cache.clone(), 0);

    let status = worker
        .next_status(UpdateStatus::UnzippingBundle(unzip_status(&cache, 40, 0)))
        .await
        .unwrap();

    assert!(matches!(status, UpdateStatus::Completed(_)));
    let record = fs
        .read_to_string(&dir.with_extension("complete"))
        .await
        .unwrap();
    assert_eq!(
        CompletionRecord::parse(&record),
        Some(CompletionRecord {
            bundle_build: 40,
            files: Some(vec![
                BundleFile {
                    path: PathBuf::from("assets/startup-1.js"),
                    size: 14,
                },
                BundleFile {
                    path: PathBuf::from("bundle-manifest.json"),
                    size: 92,
                },
                BundleFile {
                    path: PathBuf::from("index.html"),
                    size: 13,
                },
            ]),
        })
    );
    assert!(find_cached_bundle(&fs, &cache, 40, 0).await.is_some());
}
