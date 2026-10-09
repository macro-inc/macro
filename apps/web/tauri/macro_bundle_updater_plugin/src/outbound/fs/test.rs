use std::time::{SystemTime, UNIX_EPOCH};

use super::FileSystem;
use crate::domain::models::BundleRoot;

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
    let restored = BundleRoot::load(&cache_dir, &FileSystem).await;
    if test_dir.exists() {
        std::fs::remove_dir_all(&test_dir).unwrap();
    }

    result.expect("persisting an embedded selection must create the missing cache directory");
    assert!(matches!(restored, BundleRoot::Embedded));
}
