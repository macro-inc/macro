use bundle_identity::{BuiltAt, BundleBuild};

use super::BundleChecksumCache;

const BUILD: BundleBuild = BundleBuild::reported(1_794_870_406_000);

#[tokio::test]
async fn checksum_cache_is_keyed_by_bundle_build_and_build_time() {
    let cache = BundleChecksumCache::new();
    let first_build = Some(BuiltAt::from_unix_millis(1_794_871_000_000));
    let rebuild = Some(BuiltAt::from_unix_millis(1_794_872_000_000));

    cache.set((BUILD, first_build), "first".to_string()).await;
    assert_eq!(
        cache.get((BUILD, first_build)).await.as_deref(),
        Some("first")
    );

    // Re-running the deploy of one commit uploads a new archive under the
    // same bundle build; the old checksum must not be served for it.
    assert_eq!(cache.get((BUILD, rebuild)).await, None);
    assert_eq!(
        cache
            .get((BundleBuild::reported(1_794_870_407_000), first_build))
            .await,
        None
    );
}
