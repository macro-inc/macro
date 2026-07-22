use std::{collections::HashMap, sync::Arc};

use tokio::sync::Mutex;

use super::*;

#[derive(Clone, Default)]
struct FakeAssets {
    files: Arc<Mutex<HashMap<PathBuf, Vec<u8>>>>,
}

impl FakeAssets {
    async fn insert(&self, root: &str, path: &str, contents: &str) {
        self.files
            .lock()
            .await
            .insert(Path::new(root).join(path), contents.as_bytes().to_vec());
    }
}

impl BundleAssetRepo for FakeAssets {
    async fn read_asset(
        &self,
        root: &Path,
        path: &BundleAssetPath,
    ) -> Result<Option<Vec<u8>>, BundleAssetReadError> {
        Ok(self
            .files
            .lock()
            .await
            .get(&root.join(path.as_path()))
            .cloned())
    }
}

fn path(path: &str) -> BundleAssetPath {
    BundleAssetPath::new(path).unwrap()
}

#[test]
fn rejects_paths_that_escape_the_bundle_root() {
    assert_eq!(
        BundleAssetPath::new("assets/../../secret"),
        Err(InvalidBundleAssetPath)
    );
    assert_eq!(
        BundleAssetPath::new("/absolute/path"),
        Err(InvalidBundleAssetPath)
    );
}

#[tokio::test]
async fn delegates_to_embedded_assets_when_no_ota_is_active() {
    let resolver = BundleAssetResolver::new(BundleRoutes::new(1), FakeAssets::default());

    let resolution = resolver.resolve(&path("app.js")).await.unwrap();

    assert_eq!(resolution, BundleAssetResolution::Embedded);
}

#[tokio::test]
async fn reads_assets_from_the_active_ota_bundle() {
    let routes = BundleRoutes::new(1);
    routes
        .restore(BundleSource::ota(2, PathBuf::from("/ota/2")))
        .await;
    let assets = FakeAssets::default();
    assets.insert("/ota/2", "app.js", "current").await;
    let resolver = BundleAssetResolver::new(routes, assets);

    let resolution = resolver.resolve(&path("app.js")).await.unwrap();

    assert_eq!(
        resolution,
        BundleAssetResolution::Ota {
            bytes: b"current".to_vec(),
            content_path: path("app.js"),
        }
    );
}

#[tokio::test]
async fn extensionless_routes_use_the_active_ota_entrypoint() {
    let routes = BundleRoutes::new(1);
    routes
        .restore(BundleSource::ota(2, PathBuf::from("/ota/2")))
        .await;
    let assets = FakeAssets::default();
    assets.insert("/ota/2", "index.html", "entrypoint").await;
    let resolver = BundleAssetResolver::new(routes, assets);

    let resolution = resolver.resolve(&path("login")).await.unwrap();

    assert_eq!(
        resolution,
        BundleAssetResolution::Ota {
            bytes: b"entrypoint".to_vec(),
            content_path: path("index.html"),
        }
    );
}

#[tokio::test]
async fn missing_extensionful_assets_can_use_the_previous_ota_generation() {
    let routes = BundleRoutes::new(1);
    routes
        .restore(BundleSource::ota(2, PathBuf::from("/ota/2")))
        .await;
    routes
        .transition_to(BundleSource::ota(3, PathBuf::from("/ota/3")))
        .await;
    let assets = FakeAssets::default();
    assets.insert("/ota/2", "old-hash.js", "previous").await;
    let resolver = BundleAssetResolver::new(routes, assets);

    let resolution = resolver.resolve(&path("old-hash.js")).await.unwrap();

    assert_eq!(
        resolution,
        BundleAssetResolution::Ota {
            bytes: b"previous".to_vec(),
            content_path: path("old-hash.js"),
        }
    );
}

#[tokio::test]
async fn embedded_to_ota_transition_can_fall_back_to_embedded_assets() {
    let routes = BundleRoutes::new(1);
    routes
        .transition_to(BundleSource::ota(2, PathBuf::from("/ota/2")))
        .await;
    let resolver = BundleAssetResolver::new(routes, FakeAssets::default());

    let resolution = resolver.resolve(&path("embedded-hash.js")).await.unwrap();

    assert_eq!(resolution, BundleAssetResolution::Embedded);
}

#[tokio::test]
async fn ota_to_embedded_transition_checks_the_previous_ota_first() {
    let routes = BundleRoutes::new(1);
    routes
        .restore(BundleSource::ota(2, PathBuf::from("/ota/2")))
        .await;
    routes.transition_to(BundleSource::embedded(1)).await;
    let assets = FakeAssets::default();
    assets.insert("/ota/2", "ota-hash.js", "previous").await;
    let resolver = BundleAssetResolver::new(routes, assets);

    let resolution = resolver.resolve(&path("ota-hash.js")).await.unwrap();

    assert_eq!(
        resolution,
        BundleAssetResolution::Ota {
            bytes: b"previous".to_vec(),
            content_path: path("ota-hash.js"),
        }
    );
}
