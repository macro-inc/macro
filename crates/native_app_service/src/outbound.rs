use crate::domain::{
    models::{
        BUNDLE_ARCHIVE_NAME, BUNDLE_MANIFEST_FILE_NAME, BundleUpdatePolicy, DeployedManifest,
        UpdateErr,
    },
    ports::GetJsBundleManifest,
};
use bundle_identity::{BuiltAt, BundleBuild};
use futures::StreamExt;
use macro_env_var::env_vars;
use rootcause::{Report, prelude::ResultExt};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use url::Url;

env_vars! {
    pub struct BundleUpdatePolicyJson;
    pub struct BundleUpdatePolicyFile;
}

/// Which archive a checksum belongs to. Rebuilds of one commit share a
/// bundle build but upload a new archive, so the build time is part of the key.
type ArchiveKey = (BundleBuild, Option<BuiltAt>);

struct BundleChecksumCache {
    inner: RwLock<Option<(ArchiveKey, String)>>,
}

impl BundleChecksumCache {
    fn new() -> Self {
        Self {
            inner: RwLock::new(None),
        }
    }

    async fn get(&self, key: ArchiveKey) -> Option<String> {
        let (cached_key, cached_checksum) = self.inner.read().await.as_ref()?.clone();
        (cached_key == key).then_some(cached_checksum)
    }

    async fn set(&self, key: ArchiveKey, checksum: String) {
        *self.inner.write().await = Some((key, checksum));
    }
}

/// unit struct to define the default behaviour of the service
/// (not mocked service)
pub struct DefaultBundleFetcher {
    /// the base url of the frontend app
    pub base_url: Url,
    /// the file name of the bundle manifest in the js app s3 bucket
    pub manifest_file_name: &'static str,
    /// the name of the bundle archive on the s3 bucket
    pub bundle_archive_name: &'static str,
    /// cached (archive key, checksum) to avoid re-downloading the bundle
    checksum_cache: BundleChecksumCache,
}

impl DefaultBundleFetcher {
    /// Create a new [DefaultBundleFetcher] with the given base URL and default file names
    pub fn new(base_url: Url) -> Self {
        Self {
            base_url,
            manifest_file_name: BUNDLE_MANIFEST_FILE_NAME,
            bundle_archive_name: BUNDLE_ARCHIVE_NAME,
            checksum_cache: BundleChecksumCache::new(),
        }
    }

    /// Download the bundle and compute its SHA-256 hex digest by streaming
    async fn compute_checksum(&self) -> Result<String, Report<UpdateErr>> {
        async move {
            let url = self.get_app_bundle_path();
            let response = reqwest::get(url).await?.error_for_status()?;
            let mut stream = response.bytes_stream();
            let mut hasher = Sha256::new();
            while let Some(chunk) = stream.next().await {
                hasher.update(&chunk?);
            }
            Result::<_, Report>::Ok(format!("{:x}", hasher.finalize()))
        }
        .await
        .context(UpdateErr::Network)
    }
}

impl GetJsBundleManifest for DefaultBundleFetcher {
    #[tracing::instrument(skip(self), ret, err)]
    async fn get_app_bundle_manifest(&self) -> Result<DeployedManifest, Report<UpdateErr>> {
        let url = self.base_url.join(self.manifest_file_name).unwrap();
        let res = reqwest::get(url)
            .await
            .context(UpdateErr::Network)?
            .error_for_status()
            .context(UpdateErr::Network)?
            .text()
            .await
            .context(UpdateErr::Network)?;
        DeployedManifest::from_json(&res).context(UpdateErr::Manifest)
    }

    fn get_app_bundle_path(&self) -> Url {
        self.base_url.join(self.bundle_archive_name).unwrap()
    }

    #[tracing::instrument(skip(self), ret, err)]
    async fn get_app_bundle_checksum(
        &self,
        manifest: &DeployedManifest,
    ) -> Result<String, Report<UpdateErr>> {
        let key = (manifest.bundle_build(), manifest.built_at());
        if let Some(cached_checksum) = self.checksum_cache.get(key).await {
            return Ok(cached_checksum);
        }

        let checksum = self.compute_checksum().await?;
        self.checksum_cache.set(key, checksum.clone()).await;
        Ok(checksum)
    }
}

impl BundleUpdatePolicy {
    /// Load bundle update policy from `BUNDLE_UPDATE_POLICY_JSON` or `BUNDLE_UPDATE_POLICY_FILE`.
    pub fn from_env() -> Result<Self, Report<UpdateErr>> {
        if let Ok(json) = BundleUpdatePolicyJson::new() {
            return serde_json::from_str(&json).context(UpdateErr::Policy);
        }
        if let Ok(path) = BundleUpdatePolicyFile::new() {
            let json = std::fs::read_to_string(path.as_ref()).context(UpdateErr::Policy)?;
            return serde_json::from_str(&json).context(UpdateErr::Policy);
        }
        Ok(Self::default())
    }
}

#[cfg(test)]
mod test;
