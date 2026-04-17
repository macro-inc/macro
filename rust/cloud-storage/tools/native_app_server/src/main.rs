use std::sync::Arc;

use native_app_service::{
    domain::{
        models::{PlatformData, UpdateErr},
        ports::GetJsBundleSemver,
        service::NativeAppServiceImpl,
    },
    inbound::{RouterState, native_app_router},
};
use tower_http::services::ServeFile;
use url::Url;

/// Bundle fetcher that always reports a very high version, forcing an update.
struct AlwaysUpdateFetcher {
    bundle_url: Url,
    checksum: String,
}

impl GetJsBundleSemver for AlwaysUpdateFetcher {
    async fn get_app_semver(&self) -> Result<semver::Version, UpdateErr> {
        Ok(semver::Version::new(999, 0, 0))
    }

    fn get_app_bundle_path(&self) -> Url {
        self.bundle_url.clone()
    }

    async fn get_app_bundle_checksum(
        &self,
        _version: &semver::Version,
    ) -> Result<String, UpdateErr> {
        Ok(self.checksum.clone())
    }
}

const ADDR: &str = "127.0.0.1:3001";
const ARCHIVE_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/app-archive.zip");

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let bundle_url: Url = std::env::var("BUNDLE_URL")
        .unwrap_or_else(|_| format!("http://{ADDR}/app-archive.zip"))
        .parse()
        .expect("BUNDLE_URL must be a valid URL");

    let checksum = std::env::var("BUNDLE_CHECKSUM").unwrap_or_else(|_| {
        "1be759e3b1befdd6639cd89f93e9aa79857ca5c06c06e71de9b3702a9cd8af29".to_string()
    });

    let service = NativeAppServiceImpl {
        bundle_fetcher: AlwaysUpdateFetcher {
            bundle_url,
            checksum,
        },
        platform_data: PlatformData {
            ios_development_team_id: String::new(),
            ios_app_bundle_id: String::new(),
        },
    };

    let state = RouterState {
        inner: Arc::new(service),
    };

    let app =
        native_app_router(state).route_service("/app-archive.zip", ServeFile::new(ARCHIVE_PATH));

    tracing::info!("Listening on {ADDR}");

    let listener = tokio::net::TcpListener::bind(ADDR).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
