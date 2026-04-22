use crate::domain::{
    models::{BundleUpdate, BundleUpdateRequest, PlatformData, PlatformVerifier, UpdateErr},
    ports::{GetJsBundleSemver, NativeAppService},
};

/// the concrete struct which implements [NativeAppService]
pub struct NativeAppServiceImpl<T> {
    /// the implementation of [GetJsBundleSemver]
    pub bundle_fetcher: T,
    /// the platform data for various platforms
    pub platform_data: PlatformData,
}

impl<T> NativeAppService for NativeAppServiceImpl<T>
where
    T: GetJsBundleSemver,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_bundle_update(
        &self,
        req: BundleUpdateRequest,
    ) -> Result<Option<BundleUpdate>, UpdateErr> {
        let BundleUpdateRequest {
            target: _,
            arch: _,
            semver: cur_ver,
        } = req;

        let most_recent = self.bundle_fetcher.get_app_semver().await?;
        if needs_update(&most_recent, &cur_ver) {
            let checksum = self
                .bundle_fetcher
                .get_app_bundle_checksum(&most_recent)
                .await?;
            return Ok(Some(BundleUpdate {
                version: most_recent,
                notes: None,
                url: self.bundle_fetcher.get_app_bundle_path(),
                checksum,
            }));
        }

        Ok(None)
    }

    fn verification_data<P: PlatformVerifier>(&self, req: P) -> P::VerifierPayload {
        req.get_payload(&self.platform_data)
    }
}

/// Check whether the client should update to `latest` from `current`.
///
/// The `semver` crate's derived `Ord` includes build metadata in the
/// comparison, but for update purposes we follow the semver 2.0 spec:
/// compare by precedence (major.minor.patch.pre) only. When precedence
/// is equal, trigger an update if build metadata differs — each deploy
/// produces a unique build metadata tag (the short commit SHA).
pub(crate) fn needs_update(latest: &semver::Version, current: &semver::Version) -> bool {
    let precedence = latest
        .major
        .cmp(&current.major)
        .then(latest.minor.cmp(&current.minor))
        .then(latest.patch.cmp(&current.patch))
        .then(latest.pre.cmp(&current.pre));

    match precedence {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => latest.build != current.build,
    }
}
