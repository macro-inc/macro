use crate::domain::{
    models::{
        BundleAction, BundleClear, BundleNativeUpdateRequired, BundlePolicyAction, BundleUpdate,
        BundleUpdatePolicy, BundleUpdateRequest, PlatformData, PlatformVerifier, UpdateErr,
    },
    ports::{GetJsBundleManifest, NativeAppService},
};
use rootcause::Report;

/// the concrete struct which implements [NativeAppService]
pub struct NativeAppServiceImpl<T> {
    /// the implementation of [GetJsBundleManifest]
    pub bundle_fetcher: T,
    /// server-side compatibility and revocation rules
    pub bundle_policy: BundleUpdatePolicy,
    /// the platform data for various platforms
    pub platform_data: PlatformData,
}

impl<T> NativeAppService for NativeAppServiceImpl<T>
where
    T: GetJsBundleManifest,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_bundle_update(
        &self,
        req: BundleUpdateRequest,
    ) -> Result<Option<BundleAction>, Report<UpdateErr>> {
        let BundleUpdateRequest {
            target,
            arch: _,
            current_bundle_build,
            native_build,
        } = req;

        let manifest = self.bundle_fetcher.get_app_bundle_manifest().await?;

        if let Some(rule) = self.bundle_policy.rules.iter().find(|rule| {
            rule.action == BundlePolicyAction::Revoke
                && rule.matches(target, native_build, current_bundle_build)
        }) {
            return Ok(Some(BundleAction::Clear(BundleClear {
                reason: rule
                    .reason
                    .clone()
                    .unwrap_or_else(|| "bundle_revoked".to_string()),
            })));
        }

        if manifest.bundle_build <= current_bundle_build {
            return Ok(None);
        }

        if manifest.min_native_build > native_build {
            return Ok(Some(BundleAction::NativeUpdateRequired(
                BundleNativeUpdateRequired {
                    bundle_build: manifest.bundle_build,
                    min_native_build: manifest.min_native_build,
                },
            )));
        }

        if self.bundle_policy.rules.iter().any(|rule| {
            rule.action == BundlePolicyAction::Block
                && rule.matches(target, native_build, manifest.bundle_build)
        }) {
            return Ok(None);
        }

        let checksum = self
            .bundle_fetcher
            .get_app_bundle_checksum(manifest.bundle_build)
            .await?;
        Ok(Some(BundleAction::Update(BundleUpdate {
            bundle_build: manifest.bundle_build,
            min_native_build: manifest.min_native_build,
            notes: None,
            url: self.bundle_fetcher.get_app_bundle_path(),
            checksum,
        })))
    }

    fn verification_data<P: PlatformVerifier>(&self, req: P) -> P::VerifierPayload {
        req.get_payload(&self.platform_data)
    }
}
