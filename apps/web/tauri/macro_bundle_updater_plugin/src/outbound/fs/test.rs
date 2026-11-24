use std::time::{SystemTime, UNIX_EPOCH};

use super::FileSystem;
use crate::domain::{completion::BundleFile, models::BundleRoot, ports::FsRepo};

#[tokio::test]
async fn embedded_selection_persists_when_the_cache_directory_does_not_exist() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let test_dir = std::env::temp_dir().join(format!(
        "macro-embedded-bundle-root-{}-{unique}",
        std::process::id()
    ));
    let cache_dir = test_dir.join("cache");
    assert!(!cache_dir.exists());

    let result = BundleRoot::Embedded.persist(&cache_dir, &FileSystem).await;
    let (restored, _) = BundleRoot::load(&cache_dir, &FileSystem).await;
    if test_dir.exists() {
        std::fs::remove_dir_all(&test_dir).unwrap();
    }

    result.expect("persisting an embedded selection must create the missing cache directory");
    assert!(matches!(restored, BundleRoot::Embedded));
}

#[tokio::test]
async fn bundle_files_are_listed_recursively_and_their_sizes_read() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "macro-bundle-files-{}-{unique}",
        std::process::id()
    ));
    std::fs::create_dir_all(dir.join("assets/fonts")).unwrap();
    std::fs::write(dir.join("index.html"), "<html></html>").unwrap();
    std::fs::write(dir.join("assets/fonts/inter.woff2"), "font").unwrap();

    let listed = FileSystem.list_files(&dir).await;
    let sizes = FileSystem
        .file_sizes(
            &dir,
            vec![
                "assets/fonts/inter.woff2".into(),
                "assets/missing.js".into(),
            ],
        )
        .await;
    std::fs::remove_dir_all(&dir).unwrap();

    let mut listed = listed.unwrap();
    listed.sort_by(|a, b| a.path.cmp(&b.path));
    assert_eq!(
        listed,
        vec![
            BundleFile {
                path: "assets/fonts/inter.woff2".into(),
                size: 4,
            },
            BundleFile {
                path: "index.html".into(),
                size: 13,
            },
        ]
    );
    assert_eq!(sizes, vec![Ok(4), Err(std::io::ErrorKind::NotFound)]);
}
