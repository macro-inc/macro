use std::path::{Path, PathBuf};
use std::sync::Arc;

use native_app_service::{
    domain::{
        models::{PlatformData, UpdateErr},
        ports::GetJsBundleSemver,
        service::NativeAppServiceImpl,
    },
    inbound::{RouterState, native_app_router},
};
use rootcause::{Report, report};
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;
use tower_http::services::ServeFile;
use url::Url;

/// Bundle fetcher that always reports a very high version, forcing an update.
/// The checksum is recomputed from the archive on disk each time it is
/// requested, so rebuilding the archive doesn't require restarting the server.
struct AlwaysUpdateFetcher {
    bundle_url: Url,
    archive_path: PathBuf,
}

impl GetJsBundleSemver for AlwaysUpdateFetcher {
    async fn get_app_semver(&self) -> Result<semver::Version, Report<UpdateErr>> {
        Ok(semver::Version::new(999, 0, 0))
    }

    fn get_app_bundle_path(&self) -> Url {
        self.bundle_url.clone()
    }

    async fn get_app_bundle_checksum(
        &self,
        _version: &semver::Version,
    ) -> Result<String, Report<UpdateErr>> {
        sha256_hex(&self.archive_path).await.map_err(|e| {
            tracing::error!(error=?e, path=?self.archive_path, "failed to hash bundle archive");
            report!(e).context(UpdateErr::Network)
        })
    }
}

async fn sha256_hex(path: &Path) -> std::io::Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

const ADDR: &str = "0.0.0.0:3001";
const ARCHIVE_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/app-archive.zip");

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let bundle_url: Url = std::env::var("BUNDLE_URL")
        .unwrap_or_else(|_| format!("http://{ADDR}/app-archive.zip"))
        .parse()
        .expect("BUNDLE_URL must be a valid URL");

    let service = NativeAppServiceImpl {
        bundle_fetcher: AlwaysUpdateFetcher {
            bundle_url,
            archive_path: PathBuf::from(ARCHIVE_PATH),
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
