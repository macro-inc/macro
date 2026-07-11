use serde::{Deserialize, Serialize};
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

/// Metadata generated with each JavaScript bundle build.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleManifest {
    /// Manifest schema version.
    pub schema_version: u64,
    /// Monotonic JavaScript bundle build number.
    pub bundle_build: u64,
    /// Minimum native app build that can safely run this bundle.
    pub min_native_build: u64,
    /// Short git SHA used to build the bundle.
    pub git_sha: Option<String>,
    /// Application package version used for the bundle.
    pub app_version: String,
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
    pub(crate) bundle_build: u64,
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
    pub(crate) bundle_build: u64,
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
    /// the current effective JS bundle build
    pub current_bundle_build: u64,
    /// the native app build number
    pub native_build: u64,
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
    /// Inclusive minimum bundle build filter.
    pub bundle_build_gte: Option<u64>,
    /// Inclusive maximum bundle build filter.
    pub bundle_build_lte: Option<u64>,
    /// Optional reason returned for revocation rules.
    pub reason: Option<String>,
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
    pub fn matches(&self, target: AllTargets, native_build: u64, bundle_build: u64) -> bool {
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
