use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;
use url::Url;

/// The possible input desktop operating systems
/// See https://v2.tauri.app/plugin/updater/#dynamic-update-server
#[derive(Debug, Deserialize, Clone, Copy)]
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
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(strum::EnumIter))]
pub enum MobileTarget {
    /// the requesting client is on android
    Android,
    /// the requesting client is on ios
    Ios,
}

/// an enumeration of all possible tauri targets
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(untagged)]
pub enum AllTargets {
    /// desktop operating system
    Desktop(DesktopTarget),
    /// mobile operating system
    Mobile(MobileTarget),
}

/// The possible input architechtures
/// See https://v2.tauri.app/plugin/updater/#dynamic-update-server
#[derive(Debug, Deserialize, Clone, Copy)]
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

/// a struct which indicates how to update only the javascript bundle of the application
#[derive(Debug, Serialize)]
pub struct BundleUpdate {
    /// the version that we are going to update to
    pub(crate) version: semver::Version,
    /// some optional notes about the update
    pub(crate) notes: Option<String>,
    /// the fully qualified Url where the update bundle exists
    pub(crate) url: Url,
    /// the expected SHA-256 hex digest of the bundle archive
    pub(crate) checksum: String,
}

/// The payload to check if there is a native app js bundle update available
#[derive(Debug)]
pub struct BundleUpdateRequest {
    /// the target which is requesting the update
    pub target: AllTargets,
    /// the arch of the target
    pub arch: Arch,
    /// the current verison of the bundle
    pub semver: semver::Version,
}

/// the name of the semver file as it exists in the s3 bucket
pub static SEMVER_FILE_NAME: &str = "/app/semver.txt";
/// the name of the bundle file as it exists in the s3 bucket
pub static BUNDLE_ARCHIVE_NAME: &str = "/app/app-archive.zip";

/// the typed of errors that can occur while querying the bundle state
#[derive(Debug, Error)]
pub enum UpdateErr {
    /// a network error has occirred
    #[error("A network error occurred")]
    Network,
    /// failed to parse a semver string
    #[error("Failed to parse semver")]
    Semver,
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
