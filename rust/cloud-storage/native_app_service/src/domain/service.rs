use macro_env::Environment;

use crate::domain::{
    models::{BundleUpdate, BundleUpdateRequest, PlatformData, PlatformVerifier, UpdateErr},
    ports::{GetJsBundleSemver, NativeAppService},
};

/// the concrete struct which implements [NativeAppService]
pub struct NativeAppServiceImpl<T> {
    /// the implementation of [GetJsBundleSemver]
    pub bundle_fetcher: T,
    /// the environment we are running in
    pub environment: Environment,

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

        let most_recent = self
            .bundle_fetcher
            .get_app_semver(&self.environment)
            .await?;
        if most_recent > cur_ver {
            return Ok(Some(BundleUpdate {
                version: most_recent,
                notes: None,
                url: self.bundle_fetcher.get_app_bundle_path(&self.environment),
            }));
        }

        Ok(None)
    }

    fn verification_data<P: PlatformVerifier>(&self, req: P) -> P::VerifierPayload {
        req.get_payload(&self.platform_data)
    }
}
