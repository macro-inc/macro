use bundle_identity::{BuiltAt, BundleBuild, BundleManifest, NativePlatform};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::json;
use thiserror::Error;
use url::Url;

/// The possible input desktop operating systems
/// See https://v2.tauri.app/plugin/updater/#dynamic-update-server
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(strum::EnumIter))]
pub enum DesktopTarget {
    /// the requesting client is on linux
    Linux,
    /// the requesting client is on Windows
    Windows,
    /// the requesting client is on Darwin/MacOS
    Darwin,
}

/// The possible input mobile operating systems
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(strum::EnumIter))]
pub enum MobileTarget {
    /// the requesting client is on android
    Android,
    /// the requesting client is on ios
    Ios,
}

/// an enumeration of all possible tauri targets
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(untagged)]
pub enum AllTargets {
    /// desktop operating system
    Desktop(DesktopTarget),
    /// mobile operating system
    Mobile(MobileTarget),
}

/// The possible input architechtures
/// See https://v2.tauri.app/plugin/updater/#dynamic-update-server
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(test, derive(strum::EnumIter))]
#[serde(rename_all = "lowercase")]
pub enum Arch {
    /// the x86 architecture
    X86_64,
    /// this is an old and mostly deprecated system architecture
    /// but it technically could be sent
    I686,
    /// most phones and apple devices use this arch
    Aarch64,
    /// predecessor to the more modern arm architecture
    Armv7,
}

/// a struct which indicates the client should upgrade their desktop app
/// This means the system level rust binary will be updated
#[derive(Debug, Serialize)]
pub struct DesktopUpdate {
    /// code signing signature of the update bundle
    /// see https://v2.tauri.app/plugin/updater
    signature: Vec<u8>,
    /// the remaining properties of the update
    #[serde(flatten)]
    inner: BundleUpdate,
}

/// The live `bundle-manifest.json`, as deployed.
///
/// Until the first web deploy stamped by `bundle-stamp` is live, production
/// serves manifests numbered by build time. A manifest that names its commit
/// time is read strictly; one that does not is read as a legacy, reported
/// number. Reading only stamped manifests is a follow-up once one production
/// release has shipped them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeployedManifest {
    /// Stamped from its source commit by `bundle-stamp`.
    Stamped(BundleManifest),
    /// Written before commit stamping; its number is a build time.
    Legacy(LegacyManifest),
}

/// Field that marks a manifest as stamped from its commit.
const COMMIT_TIME_FIELD: &str = "commitTime";

impl DeployedManifest {
    /// Parse a live manifest: strictly when it names a commit time.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        let value: serde_json::Value = serde_json::from_str(json)?;
        if value.get(COMMIT_TIME_FIELD).is_some() {
            return serde_json::from_value(value).map(Self::Stamped);
        }

        serde_json::from_value(value).map(Self::Legacy)
    }

    /// The update ordering key.
    pub fn bundle_build(&self) -> BundleBuild {
        match self {
            Self::Stamped(manifest) => manifest.bundle_build(),
            Self::Legacy(manifest) => BundleBuild::reported(manifest.bundle_build),
        }
    }

    /// When this build ran, if the manifest records it. Rebuilds of one commit
    /// share a [`BundleBuild`] but not a build time.
    pub fn built_at(&self) -> Option<BuiltAt> {
        match self {
            Self::Stamped(manifest) => manifest.built_at(),
            Self::Legacy(_) => None,
        }
    }

    /// The manifest schema version.
    pub fn schema_version(&self) -> u64 {
        match self {
            Self::Stamped(manifest) => manifest.schema_version(),
            Self::Legacy(manifest) => manifest.schema_version,
        }
    }

    /// Select the minimum for the requesting platform, rejecting unknown schemas.
    pub fn minimum_for(&self, target: AllTargets) -> Option<u64> {
        match self {
            Self::Stamped(manifest) => manifest.minimum_for(target.into()),
            Self::Legacy(manifest) => manifest.minimum_for(target),
        }
    }

    /// Whether this bundle was built from the commit `git_sha` names.
    ///
    /// Release builds abbreviate SHAs to different lengths, so one may be a
    /// prefix of the other. Anything shorter than seven hex digits never matches.
    pub fn built_from(&self, git_sha: &str) -> bool {
        let own = match self {
            Self::Stamped(manifest) => Some(manifest.source().sha().as_str()),
            Self::Legacy(manifest) => manifest.git_sha.as_deref(),
        };
        let Some(own) = own else {
            return false;
        };
        let valid =
            |sha: &str| sha.len() >= MIN_GIT_SHA_LEN && sha.bytes().all(|b| b.is_ascii_hexdigit());
        if !valid(own) || !valid(git_sha) {
            return false;
        }
        let (own, other) = (own.to_ascii_lowercase(), git_sha.to_ascii_lowercase());
        own.starts_with(&other) || other.starts_with(&own)
    }
}

impl From<AllTargets> for NativePlatform {
    fn from(target: AllTargets) -> Self {
        match target {
            AllTargets::Mobile(MobileTarget::Android) => Self::Android,
            AllTargets::Mobile(MobileTarget::Ios) => Self::Ios,
            AllTargets::Desktop(_) => Self::Desktop,
        }
    }
}

/// A manifest written before commit stamping, numbered by build time.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyManifest {
    /// Manifest schema version.
    pub schema_version: u64,
    /// Build time of the bundle, Unix milliseconds.
    pub bundle_build: u64,
    /// Minimum native app build that can safely run this bundle.
    pub min_native_build: u64,
    /// Platform-specific native minima. Schema 3 requires both mobile platforms.
    #[serde(default)]
    pub min_native_builds: Option<MobileBuildMinima>,
    /// Short git SHA used to build the bundle.
    pub git_sha: Option<String>,
    /// Application package version used for the bundle.
    pub app_version: String,
}

/// Shortest abbreviated SHA trusted to identify a commit.
const MIN_GIT_SHA_LEN: usize = 7;

/// Native build numbers are independent across mobile platforms.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct MobileBuildMinima {
    /// Minimum Android versionCode.
    pub android: u64,
    /// Minimum iOS CFBundleVersion.
    pub ios: u64,
}

impl LegacyManifest {
    /// Select the minimum for the requesting platform, rejecting unknown schemas.
    pub fn minimum_for(&self, target: AllTargets) -> Option<u64> {
        match (self.schema_version, &self.min_native_builds, target) {
            (2, None, AllTargets::Mobile(MobileTarget::Android)) => None,
            (2, None, _) => Some(self.min_native_build),
            (3, Some(builds), AllTargets::Mobile(MobileTarget::Android)) => Some(builds.android),
            (3, Some(builds), AllTargets::Mobile(MobileTarget::Ios)) => Some(builds.ios),
            // Desktop keeps the shared minimum; its release numbers come from
            // hand-typed tags, so they cannot gate updater capabilities.
            (3, Some(_), AllTargets::Desktop(_)) => Some(self.min_native_build),
            _ => None,
        }
    }
}

/// Action returned by the bundle update endpoint.
#[derive(Debug, Serialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum BundleAction {
    /// Download and apply a newer compatible bundle.
    Update(BundleUpdate),
    /// Clear the active cached OTA bundle.
    Clear(BundleClear),
    /// A newer bundle exists, but the requesting native app build is too old.
    #[serde(rename = "native_update_required")]
    NativeUpdateRequired(BundleNativeUpdateRequired),
}

/// a struct which indicates how to update only the javascript bundle of the application
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleUpdate {
    /// the bundle build that we are going to update to
    pub(crate) bundle_build: BundleBuild,
    /// the minimum native build that can run this bundle
    pub(crate) min_native_build: u64,
    /// some optional notes about the update
    pub(crate) notes: Option<String>,
    /// the fully qualified Url where the update bundle exists
    pub(crate) url: Url,
    /// the expected SHA-256 hex digest of the bundle archive
    pub(crate) checksum: String,
}

/// A response instructing the client to clear the active OTA bundle.
#[derive(Debug, Serialize)]
pub struct BundleClear {
    /// Machine-readable clear reason.
    pub(crate) reason: String,
}

/// A response telling the client a native app update is required before this bundle can run.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleNativeUpdateRequired {
    /// The newer bundle build that could not be offered.
    pub(crate) bundle_build: BundleBuild,
    /// The minimum native build required by that bundle.
    pub(crate) min_native_build: u64,
}

/// The payload to check if there is a native app js bundle update available
#[derive(Debug)]
pub struct BundleUpdateRequest {
    /// the target which is requesting the update
    pub target: AllTargets,
    /// the arch of the target
    pub arch: Arch,
    /// the current effective JS bundle build, as the app reports it
    pub current_bundle_build: BundleBuild,
    /// the native app build number
    pub native_build: u64,
    /// The newest bundle manifest schema the updater reads. Desktop updaters
    /// that predate schema 3 send none and reject it after downloading.
    pub manifest_schema: Option<u64>,
    /// Short git SHA of the commit the running bundle was built from, when the
    /// app knows it. Older apps send none.
    pub current_git_sha: Option<String>,
    /// The updater reads only manifests stamped from a commit, so a legacy
    /// live manifest is never offered to it. Older apps send none.
    pub stamped_manifests: bool,
}

/// Server-side compatibility and revocation rules for JS bundle updates.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BundleUpdatePolicy {
    /// Ordered rules evaluated at request time.
    pub rules: Vec<BundlePolicyRule>,
}

/// One server-side policy rule.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundlePolicyRule {
    /// Whether this rule blocks future updates or revokes active bundles.
    pub action: BundlePolicyAction,
    /// Optional target filter.
    pub target: Option<AllTargets>,
    /// Inclusive minimum native build filter.
    pub native_build_gte: Option<u64>,
    /// Inclusive maximum native build filter.
    pub native_build_lte: Option<u64>,
    /// Inclusive minimum bundle build filter (`bundle-stamp number <sha>`).
    #[serde(default, deserialize_with = "reported_bundle_build")]
    pub bundle_build_gte: Option<BundleBuild>,
    /// Inclusive maximum bundle build filter (`bundle-stamp number <sha>`).
    #[serde(default, deserialize_with = "reported_bundle_build")]
    pub bundle_build_lte: Option<BundleBuild>,
    /// Optional reason returned for revocation rules.
    pub reason: Option<String>,
}

/// Policy ranges are numbers an operator wrote down.
fn reported_bundle_build<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<BundleBuild>, D::Error> {
    Ok(Option::<u64>::deserialize(deserializer)?.map(BundleBuild::reported))
}

/// Policy action to apply when a rule matches.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BundlePolicyAction {
    /// Prevent a matching deployed bundle from being offered.
    Block,
    /// Clear a matching active bundle from clients.
    Revoke,
}

impl BundlePolicyRule {
    /// Return whether this rule matches the request target, native build, and bundle build.
    pub fn matches(
        &self,
        target: AllTargets,
        native_build: u64,
        bundle_build: BundleBuild,
    ) -> bool {
        if self.target.is_some_and(|expected| expected != target) {
            return false;
        }
        if self.native_build_gte.is_some_and(|min| native_build < min) {
            return false;
        }
        if self.native_build_lte.is_some_and(|max| native_build > max) {
            return false;
        }
        if self.bundle_build_gte.is_some_and(|min| bundle_build < min) {
            return false;
        }
        if self.bundle_build_lte.is_some_and(|max| bundle_build > max) {
            return false;
        }
        true
    }
}

/// the name of the manifest file as it exists in the s3 bucket
pub static BUNDLE_MANIFEST_FILE_NAME: &str = "/app/bundle-manifest.json";
/// the name of the bundle file as it exists in the s3 bucket
pub static BUNDLE_ARCHIVE_NAME: &str = "/app/app-archive.zip";

/// the typed of errors that can occur while querying the bundle state
#[derive(Debug, Error)]
pub enum UpdateErr {
    /// a network error has occirred
    #[error("A network error occurred")]
    Network,
    /// failed to parse a bundle manifest
    #[error("Failed to parse bundle manifest")]
    Manifest,
    /// failed to parse the update policy
    #[error("Failed to parse bundle update policy")]
    Policy,
}

/// contains information about bundle ids for various app platforms
pub struct PlatformData {
    /// the ios xcode dev team id
    pub ios_development_team_id: String,
    /// the ios xcode bundle id
    pub ios_app_bundle_id: String,
}

/// trait which defines how we fetch platform verification data for different platforms
pub trait PlatformVerifier {
    /// the type of the output data
    type VerifierPayload: Serialize;

    /// get the verifier payload
    fn get_payload(&self, platform_data: &PlatformData) -> Self::VerifierPayload;
}

/// the concrete struct which is used to produce the iOS verification payload
pub struct IOSVerifier;

impl PlatformVerifier for IOSVerifier {
    type VerifierPayload = serde_json::Value;

    fn get_payload(&self, platform_data: &PlatformData) -> Self::VerifierPayload {
        json!({
          "applinks": {
            "details": [
              {
                "appIDs": [format_args!("{}.{}", platform_data.ios_development_team_id, platform_data.ios_app_bundle_id)],
                "components": [
                  {
                    "/": "/app/*",
                    "comment": "Matches any URL whose path starts with /app/"
                  }
                ]
              }
            ]
          }
        })
    }
}
