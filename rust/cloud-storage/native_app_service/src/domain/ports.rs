use crate::domain::models::{BundleUpdate, BundleUpdateRequest, PlatformVerifier, UpdateErr};
use url::Url;

/// outbound trait for sending network requests to query the bundle state
pub trait GetJsBundleSemver: Send + Sync + 'static {
    /// fetch the semver of the current app over the network
    fn get_app_semver(&self) -> impl Future<Output = Result<semver::Version, UpdateErr>> + Send;
    /// get the Url of the bundle
    fn get_app_bundle_path(&self) -> Url;
    /// get the SHA-256 hex digest of the bundle archive for the given version
    fn get_app_bundle_checksum(
        &self,
        version: &semver::Version,
    ) -> impl Future<Output = Result<String, UpdateErr>> + Send;
}

/// the service level trait for dealing with tauri app integration
pub trait NativeAppService: Send + Sync + 'static {
    /// returns an `Option<BundleUpdate>` to denote that no errors occurred but there is no
    /// update available
    fn get_bundle_update(
        &self,
        req: BundleUpdateRequest,
    ) -> impl Future<Output = Result<Option<BundleUpdate>, UpdateErr>> + Send;

    /// retrieve the verification payload for some platform T
    fn verification_data<T: PlatformVerifier>(&self, req: T) -> T::VerifierPayload;
}
