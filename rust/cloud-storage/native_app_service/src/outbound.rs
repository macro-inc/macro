use crate::domain::{
    models::{BUNDLE_ARCHIVE_NAME, SEMVER_FILE_NAME, UpdateErr},
    ports::GetJsBundleSemver,
};
use std::str::FromStr;
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
}

impl DefaultBundleFetcher {
    /// Create a new [DefaultBundleFetcher] with the given base URL and default file names
    pub fn new(base_url: Url) -> Self {
        Self {
            base_url,
            semver_file_name: SEMVER_FILE_NAME,
            bundle_archive_name: BUNDLE_ARCHIVE_NAME,
        }
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
        self.base_url
            .join(self.bundle_archive_name)
            .unwrap()
    }
}
