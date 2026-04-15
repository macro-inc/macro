use crate::domain::{
    models::{BUNDLE_ARCHIVE_NAME, SEMVER_FILE_NAME, UpdateErr},
    ports::GetJsBundleSemver,
};
use sha2::{Digest, Sha256};
use std::str::FromStr;
use tokio::sync::RwLock;
use url::Url;

/// unit struct to define the default behaviour of the service
/// (not mocked service)
pub struct DefaultBundleFetcher {
    /// the base url of the frontend app
    pub base_url: Url,
    /// the file name of the semver file in the js app s3 bucket
    pub semver_file_name: &'static str,
    /// the name of the bundle archive on the s3 bucket
    pub bundle_archive_name: &'static str,
    /// cached (version, checksum) to avoid re-downloading the bundle
    checksum_cache: RwLock<Option<(semver::Version, String)>>,
}

impl DefaultBundleFetcher {
    /// Create a new [DefaultBundleFetcher] with the given base URL and default file names
    pub fn new(base_url: Url) -> Self {
        Self {
            base_url,
            semver_file_name: SEMVER_FILE_NAME,
            bundle_archive_name: BUNDLE_ARCHIVE_NAME,
            checksum_cache: RwLock::new(None),
        }
    }

    /// Download the bundle and compute its SHA-256 hex digest
    async fn compute_checksum(&self) -> Result<String, UpdateErr> {
        let url = self.get_app_bundle_path();
        let bytes = reqwest::get(url)
            .await
            .map_err(anyhow::Error::from)?
            .error_for_status()
            .map_err(anyhow::Error::from)?
            .bytes()
            .await
            .map_err(anyhow::Error::from)?;
        let hash = Sha256::digest(&bytes);
        Ok(format!("{:x}", hash))
    }
}

impl GetJsBundleSemver for DefaultBundleFetcher {
    #[tracing::instrument(skip(self), ret, err)]
    async fn get_app_semver(&self) -> Result<semver::Version, UpdateErr> {
        let url = self.base_url.join(self.semver_file_name).unwrap();
        let res = reqwest::get(url)
            .await
            .map_err(anyhow::Error::from)?
            .error_for_status()
            .map_err(anyhow::Error::from)?
            .text()
            .await
            .map_err(anyhow::Error::from)?;
        let cur_ver = semver::Version::from_str(res.trim())?;
        Ok(cur_ver)
    }

    fn get_app_bundle_path(&self) -> Url {
        self.base_url.join(self.bundle_archive_name).unwrap()
    }

    #[tracing::instrument(skip(self), ret, err)]
    async fn get_app_bundle_checksum(
        &self,
        version: &semver::Version,
    ) -> Result<String, UpdateErr> {
        // return cached checksum if version matches
        if let Some((cached_ver, cached_checksum)) = self.checksum_cache.read().await.as_ref()
            && cached_ver == version
        {
            return Ok(cached_checksum.clone());
        }

        let checksum = self.compute_checksum().await?;
        *self.checksum_cache.write().await = Some((version.clone(), checksum.clone()));
        Ok(checksum)
    }
}
