use crate::domain::models::{
    BundleAction, BundleUpdateRequest, DeployedManifest, PlatformVerifier, UpdateErr,
};
use rootcause::Report;
use url::Url;

/// outbound trait for sending network requests to query the bundle state
pub trait GetJsBundleManifest: Send + Sync + 'static {
    /// fetch the manifest of the current app bundle over the network
    fn get_app_bundle_manifest(
        &self,
    ) -> impl Future<Output = Result<DeployedManifest, Report<UpdateErr>>> + Send;
    /// get the Url of the bundle
    fn get_app_bundle_path(&self) -> Url;
    /// get the SHA-256 hex digest of the bundle archive the given manifest describes
    fn get_app_bundle_checksum(
        &self,
        manifest: &DeployedManifest,
    ) -> impl Future<Output = Result<String, Report<UpdateErr>>> + Send;
}

/// the service level trait for dealing with tauri app integration
pub trait NativeAppService: Send + Sync + 'static {
    /// returns an `Option<BundleAction>` to denote that no errors occurred but there is no
    /// update available
    fn get_bundle_update(
        &self,
        req: BundleUpdateRequest,
    ) -> impl Future<Output = Result<Option<BundleAction>, Report<UpdateErr>>> + Send;

    /// retrieve the verification payload for some platform T
    fn verification_data<T: PlatformVerifier>(&self, req: T) -> T::VerifierPayload;
}
