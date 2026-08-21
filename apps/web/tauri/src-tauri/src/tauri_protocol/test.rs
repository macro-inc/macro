use std::{path::Path, sync::Arc};

use macro_bundle_updater_plugin::domain::bundle_routes::{BundleRoutes, BundleSource};
use tokio::sync::Notify;

use super::*;

#[derive(Clone)]
struct BlockingAssets {
    read_started: Arc<Notify>,
    finish_read: Arc<Notify>,
}

impl BundleAssetRepo for BlockingAssets {
    async fn read_asset(
        &self,
        _root: &Path,
        _path: &BundleAssetPath,
    ) -> Result<Option<Vec<u8>>, BundleAssetReadError> {
        self.read_started.notify_one();
        self.finish_read.notified().await;
        Ok(Some(Vec::new()))
    }
}

#[test]
fn strips_only_complete_app_path_segments() {
    assert_eq!(strip_app_prefix("/app/assets/main.js"), "assets/main.js");
    assert_eq!(strip_app_prefix("/app"), "");
    assert_eq!(strip_app_prefix("/app.css"), "/app.css");
}

#[test]
fn parses_asset_paths_without_query_parameters() {
    let uri = "tauri://localhost/app/assets/main.js?cache=1"
        .parse::<http::Uri>()
        .unwrap();

    let path = request_asset_path(&uri).unwrap();

    assert_eq!(path.as_path(), Path::new("assets/main.js"));
}

#[test]
fn root_path_resolves_to_the_entrypoint() {
    let uri = "tauri://localhost/app".parse::<http::Uri>().unwrap();

    let path = request_asset_path(&uri).unwrap();

    assert_eq!(path.as_path(), Path::new("index.html"));
}

#[test]
fn rejects_percent_encoded_path_traversal() {
    let uri = "tauri://localhost/app/assets/%2e%2e/secret"
        .parse::<http::Uri>()
        .unwrap();

    assert!(matches!(
        request_asset_path(&uri),
        Err(RequestPathError::Unsafe(_))
    ));
}

#[test]
fn rejects_invalid_percent_encoding() {
    let uri = "tauri://localhost/app/assets/%ZZ"
        .parse::<http::Uri>()
        .unwrap();

    assert_eq!(
        request_asset_path(&uri),
        Err(RequestPathError::InvalidEncoding)
    );
}

#[test]
fn rewrites_embedded_asset_uris() {
    assert_eq!(
        rewrite_uri("tauri://localhost/app/assets/main.js?cache=1"),
        "tauri://localhost/assets/main.js?cache=1"
    );
    assert_eq!(
        rewrite_uri("https://tauri.localhost/app/login"),
        "https://tauri.localhost/login"
    );
    assert_eq!(
        rewrite_uri("tauri://localhost/app?cache=1"),
        "tauri://localhost/?cache=1"
    );
    assert_eq!(
        rewrite_uri("tauri://localhost/app.css"),
        "tauri://localhost/app.css"
    );
}

#[tokio::test]
async fn timed_out_asset_read_keeps_route_lease_until_read_finishes() {
    let routes = BundleRoutes::new(1);
    routes
        .transition_to(BundleSource::ota(2, "/cache/2".into()))
        .await;
    let read_started = Arc::new(Notify::new());
    let finish_read = Arc::new(Notify::new());
    let resolver = BundleAssetResolver::new(
        routes.clone(),
        BlockingAssets {
            read_started: read_started.clone(),
            finish_read: finish_read.clone(),
        },
    );

    let resolution = tokio::spawn(resolve_asset_with_timeout(
        resolver,
        BundleAssetPath::new("main.js").unwrap(),
        Duration::from_millis(1),
    ));
    read_started.notified().await;
    assert!(matches!(
        resolution.await.unwrap(),
        TimedAssetResolution::TimedOut
    ));

    let finish_transition = tokio::spawn({
        let routes = routes.clone();
        async move { routes.finish_transition().await }
    });
    tokio::task::yield_now().await;
    assert!(!finish_transition.is_finished());

    finish_read.notify_one();
    assert_eq!(
        finish_transition.await.unwrap(),
        Some(BundleSource::embedded(1))
    );
}
