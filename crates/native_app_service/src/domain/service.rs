use crate::domain::{
    models::{
        AllTargets, BundleAction, BundleClear, BundleNativeUpdateRequired, BundlePolicyAction,
        BundleUpdate, BundleUpdatePolicy, BundleUpdateRequest, DeployedManifest, PlatformData,
        PlatformVerifier, UpdateErr,
    },
    ports::{GetJsBundleManifest, NativeAppService},
};
use rootcause::Report;

/// Desktop updaters that send no `manifest_schema` read schema 2 only.
const LEGACY_DESKTOP_MANIFEST_SCHEMA: u64 = 2;

/// the concrete struct which implements [NativeAppService]
pub struct NativeAppServiceImpl<T> {
    /// the implementation of [GetJsBundleManifest]
    pub bundle_fetcher: T,
    /// server-side compatibility and revocation rules
    pub bundle_policy: BundleUpdatePolicy,
    /// the platform data for various platforms
    pub platform_data: PlatformData,
}

/// What an update check decided.
enum Decision {
    /// Answer with this action.
    Offer(BundleAction),
    /// Answer with no update, for this reason.
    Skip(NoUpdate),
}

/// Why an update check offered nothing, recorded as the span's `outcome`.
#[derive(Clone, Copy)]
enum NoUpdate {
    /// The updater reads only stamped manifests and the live one is legacy.
    LegacyManifest,
    /// The live bundle is not newer than the running one.
    NotNewer,
    /// The live bundle comes from the running commit (transitional sha check).
    SameCommit,
    /// A desktop updater that cannot read the live manifest's schema.
    DesktopSchema,
    /// The live manifest states no minimum for this platform.
    NoMinimum,
    /// A policy rule blocks the live bundle.
    Blocked,
}

impl NoUpdate {
    fn outcome(self) -> &'static str {
        match self {
            Self::LegacyManifest => "no_update_legacy_manifest",
            Self::NotNewer => "no_update_not_newer",
            Self::SameCommit => "no_update_same_commit",
            Self::DesktopSchema => "no_update_desktop_schema",
            Self::NoMinimum => "no_update_no_minimum",
            Self::Blocked => "no_update_blocked",
        }
    }
}

impl BundleAction {
    fn outcome(&self) -> &'static str {
        match self {
            Self::Update(_) => "update",
            Self::Clear(_) => "clear",
            Self::NativeUpdateRequired(_) => "native_update_required",
        }
    }
}

impl<T> NativeAppServiceImpl<T>
where
    T: GetJsBundleManifest,
{
    async fn decide(&self, req: BundleUpdateRequest) -> Result<Decision, Report<UpdateErr>> {
        let BundleUpdateRequest {
            target,
            arch: _,
            current_bundle_build,
            native_build,
            manifest_schema,
            current_git_sha,
            stamped_manifests,
        } = req;

        let manifest = self.bundle_fetcher.get_app_bundle_manifest().await?;

        if let Some(rule) = self.bundle_policy.rules.iter().find(|rule| {
            rule.action == BundlePolicyAction::Revoke
                && rule.matches(target, native_build, current_bundle_build)
        }) {
            return Ok(Decision::Offer(BundleAction::Clear(BundleClear {
                reason: rule
                    .reason
                    .clone()
                    .unwrap_or_else(|| "bundle_revoked".to_string()),
            })));
        }

        // An updater that reads only stamped manifests would download a legacy
        // bundle, reject it, and download it again on every check.
        if stamped_manifests && matches!(manifest, DeployedManifest::Legacy(_)) {
            return Ok(Decision::Skip(NoUpdate::LegacyManifest));
        }

        let bundle_build = manifest.bundle_build();
        if bundle_build <= current_bundle_build {
            return Ok(Decision::Skip(NoUpdate::NotNewer));
        }

        // Transition: while production still serves legacy manifests numbered
        // by build time, a desktop release (numbered by commit time) would see
        // the deploy of its own commit as newer. Same commit, same bundle:
        // nothing to download. Stamped manifests already compare equal.
        if current_git_sha
            .as_deref()
            .is_some_and(|sha| manifest.built_from(sha))
        {
            return Ok(Decision::Skip(NoUpdate::SameCommit));
        }

        if matches!(target, AllTargets::Desktop(_))
            && manifest.schema_version() > manifest_schema.unwrap_or(LEGACY_DESKTOP_MANIFEST_SCHEMA)
        {
            return Ok(Decision::Skip(NoUpdate::DesktopSchema));
        }

        let Some(min_native_build) = manifest.minimum_for(target) else {
            return Ok(Decision::Skip(NoUpdate::NoMinimum));
        };

        if min_native_build > native_build {
            return Ok(Decision::Offer(BundleAction::NativeUpdateRequired(
                BundleNativeUpdateRequired {
                    bundle_build,
                    min_native_build,
                },
            )));
        }

        if self.bundle_policy.rules.iter().any(|rule| {
            rule.action == BundlePolicyAction::Block
                && rule.matches(target, native_build, bundle_build)
        }) {
            return Ok(Decision::Skip(NoUpdate::Blocked));
        }

        let checksum = self
            .bundle_fetcher
            .get_app_bundle_checksum(&manifest)
            .await?;
        Ok(Decision::Offer(BundleAction::Update(BundleUpdate {
            bundle_build,
            min_native_build,
            notes: None,
            url: self.bundle_fetcher.get_app_bundle_path(),
            checksum,
        })))
    }
}

impl<T> NativeAppService for NativeAppServiceImpl<T>
where
    T: GetJsBundleManifest,
{
    #[tracing::instrument(err, skip(self), fields(outcome = tracing::field::Empty))]
    async fn get_bundle_update(
        &self,
        req: BundleUpdateRequest,
    ) -> Result<Option<BundleAction>, Report<UpdateErr>> {
        let (outcome, action) = match self.decide(req).await? {
            Decision::Offer(action) => (action.outcome(), Some(action)),
            Decision::Skip(reason) => (reason.outcome(), None),
        };
        tracing::Span::current().record("outcome", outcome);
        Ok(action)
    }

    fn verification_data<P: PlatformVerifier>(&self, req: P) -> P::VerifierPayload {
        req.get_payload(&self.platform_data)
    }
}
