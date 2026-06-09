use crate::domain::{
    models::{
        BUNDLE_ARCHIVE_NAME, BUNDLE_MANIFEST_FILE_NAME, BundleManifest, BundleUpdatePolicy,
        UpdateErr,
    },
    ports::GetJsBundleManifest,
};
use futures::StreamExt;
use rootcause::{Report, prelude::ResultExt};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use url::Url;

struct BundleChecksumCache {
    inner: RwLock<Option<(u64, String)>>,
}

impl BundleChecksumCache {
    fn new() -> Self {
        Self {
            inner: RwLock::new(None),
        }
    }

    async fn get(&self, bundle_build: u64) -> Option<String> {
        let (cached_build, cached_checksum) = self.inner.read().await.as_ref()?.clone();
        (cached_build == bundle_build).then_some(cached_checksum)
    }

    async fn set(&self, bundle_build: u64, checksum: String) {
        *self.inner.write().await = Some((bundle_build, checksum));
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
    /// cached (bundle build, checksum) to avoid re-downloading the bundle
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
    async fn get_app_bundle_manifest(&self) -> Result<BundleManifest, Report<UpdateErr>> {
        let url = self.base_url.join(self.manifest_file_name).unwrap();
        let res = reqwest::get(url)
            .await
            .context(UpdateErr::Network)?
            .error_for_status()
            .context(UpdateErr::Network)?
            .text()
            .await
            .context(UpdateErr::Network)?;
        serde_json::from_str(&res).context(UpdateErr::Manifest)
    }

    fn get_app_bundle_path(&self) -> Url {
        self.base_url.join(self.bundle_archive_name).unwrap()
    }

    #[tracing::instrument(skip(self), ret, err)]
    async fn get_app_bundle_checksum(
        &self,
        bundle_build: u64,
    ) -> Result<String, Report<UpdateErr>> {
        // return cached checksum if bundle build matches
        if let Some(cached_checksum) = self.checksum_cache.get(bundle_build).await {
            return Ok(cached_checksum);
        }

        let checksum = self.compute_checksum().await?;
        self.checksum_cache
            .set(bundle_build, checksum.clone())
            .await;
        Ok(checksum)
    }
}

impl BundleUpdatePolicy {
    /// Load bundle update policy from `BUNDLE_UPDATE_POLICY_JSON` or `BUNDLE_UPDATE_POLICY_FILE`.
    pub fn from_env() -> Result<Self, Report<UpdateErr>> {
        if let Ok(json) = std::env::var("BUNDLE_UPDATE_POLICY_JSON") {
            return serde_json::from_str(&json).context(UpdateErr::Policy);
        }
        if let Ok(path) = std::env::var("BUNDLE_UPDATE_POLICY_FILE") {
            let json = std::fs::read_to_string(path).context(UpdateErr::Policy)?;
            return serde_json::from_str(&json).context(UpdateErr::Policy);
        }
        Ok(Self::default())
    }
}

#[cfg(test)]
mod tests {
    use super::BundleChecksumCache;

    #[tokio::test]
    async fn checksum_cache_is_keyed_by_bundle_build() {
        let cache = BundleChecksumCache::new();

        cache.set(100, "checksum-100".to_string()).await;
        assert_eq!(cache.get(100).await.as_deref(), Some("checksum-100"));
        assert_eq!(cache.get(101).await, None);

        cache.set(101, "checksum-101".to_string()).await;
        assert_eq!(cache.get(100).await, None);
        assert_eq!(cache.get(101).await.as_deref(), Some("checksum-101"));
    }
}
