use serde::Deserialize;
use std::path::{Path, PathBuf};
use strum::IntoStaticStr;
use thiserror::Error;
use tokio::sync::mpsc::{Receiver, channel};
use url::Url;

use super::ports::FsRepo;

/// Name of the file used to persist the bundle root path across restarts.
const BUNDLE_ROOT_FILE: &str = "bundle_root";

/// Swappable root directory for serving frontend assets.
/// `None` = use built-in asset resolver (initial bundle from `frontendDist`).
/// `Some(path)` = serve files from this directory (after OTA update).
pub(crate) struct BundleRoot(Option<PathBuf>);

impl BundleRoot {
    /// Create an empty bundle root (no OTA update applied).
    pub(crate) fn new() -> Self {
        Self(None)
    }

    /// Create a bundle root pointing to the given path.
    pub(crate) fn from_path(path: PathBuf) -> Self {
        Self(Some(path))
    }

    /// Load persisted bundle root from the given cache directory.
    pub(crate) async fn load(cache_dir: &Path, fs: &impl FsRepo) -> Self {
        let persist_path = cache_dir.join(BUNDLE_ROOT_FILE);
        tracing::debug!("Loading bundle root from {persist_path:?}");
        match fs.read_to_string(&persist_path).await {
            Ok(contents) => {
                let path = PathBuf::from(contents.trim());
                let index = path.join("index.html");
                if fs.read_to_string(&index).await.is_ok() {
                    tracing::debug!("Restored bundle root: {path:?}");
                    Self(Some(path))
                } else {
                    tracing::warn!(
                        "Persisted bundle root {path:?} missing index.html at {index:?}"
                    );
                    if let Err(e) = fs.remove_file(&persist_path).await {
                        tracing::debug!("Failed to remove stale bundle_root file: {e}");
                    }
                    Self(None)
                }
            }
            Err(e) => {
                tracing::debug!("No persisted bundle root: {e}");
                Self(None)
            }
        }
    }

    /// Persist the bundle root path so it survives app restarts.
    pub(crate) async fn persist(
        &self,
        cache_dir: &Path,
        fs: &impl FsRepo,
    ) -> Result<(), std::io::Error> {
        let persist_path = cache_dir.join(BUNDLE_ROOT_FILE);
        match self.0.as_ref() {
            Some(root) => {
                tracing::debug!("Persisting bundle root {root:?} to {persist_path:?}");
                fs.write(&persist_path, root.to_string_lossy().as_bytes())
                    .await
            }
            None => fs.remove_file(&persist_path).await,
        }
    }

    /// Get the current bundle root path, if any.
    pub(crate) fn path(&self) -> Option<&Path> {
        self.0.as_deref()
    }

    /// Clear the bundle root, reverting to the built-in assets.
    pub(crate) fn clear(&mut self) {
        self.0 = None;
    }

    /// Read the bundle manifest inside the bundle root.
    pub(crate) async fn manifest(&self, fs: &impl FsRepo) -> Option<BundleManifest> {
        let manifest_path = self.0.as_ref()?.join("bundle-manifest.json");
        BundleManifest::read(&manifest_path, fs).await
    }
}

/// Metadata generated with each JavaScript bundle build.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
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

impl BundleManifest {
    /// Read and validate a bundle manifest from disk.
    pub async fn read(path: &Path, fs: &impl FsRepo) -> Option<Self> {
        let manifest = fs
            .read_to_string(path)
            .await
            .ok()
            .and_then(|s| serde_json::from_str::<Self>(&s).ok())?;
        if manifest.schema_version == 2 {
            Some(manifest)
        } else {
            None
        }
    }
}

/// the bounded size of mpsc channels
const MPSC_CHAN_SIZE: usize = 10;

/// Application metadata sent to the update server.
#[derive(Debug, Clone)]
pub struct AppInfo {
    /// The current effective JS bundle build.
    pub current_bundle_build: u64,
    /// The native app build number.
    pub native_build: u64,
    /// CPU architecture.
    pub arch: Arch,
    /// Operating system target.
    pub target: Target,
}

/// The possible input desktop operating systems
/// See https://v2.tauri.app/plugin/updater/#dynamic-update-server
#[derive(Debug, Clone, Copy, IntoStaticStr)]
#[strum(serialize_all = "lowercase")]
pub enum Target {
    /// the requesting client is on linux
    Linux,
    /// the requesting client is on Windows
    Windows,
    /// the requesting client is on Darwin/MacOS
    Darwin,
    /// the requesting client is on ios
    Ios,
    /// the requesting client is on android
    Android,
}

/// The possible input architechtures
/// See https://v2.tauri.app/plugin/updater/#dynamic-update-server
#[derive(Debug, Clone, Copy, IntoStaticStr)]
#[strum(serialize_all = "lowercase")]
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

/// Action returned by the bundle update endpoint.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum BundleAction {
    /// Download and apply a newer compatible bundle.
    Update(BundleUpdate),
    /// Clear the active cached OTA bundle.
    Clear(BundleClear),
    /// A newer bundle exists, but the installed native app build is too old.
    #[serde(rename = "native_update_required")]
    NativeUpdateRequired(BundleNativeUpdateRequired),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_native_update_required_action() {
        let action: BundleAction = serde_json::from_str(
            r#"{"action":"native_update_required","bundleBuild":102,"minNativeBuild":999999}"#,
        )
        .unwrap();

        assert!(matches!(
            action,
            BundleAction::NativeUpdateRequired(BundleNativeUpdateRequired {
                bundle_build: 102,
                min_native_build: 999999,
            })
        ));
    }
}

/// A response instructing the client to clear the active OTA bundle.
#[derive(Debug, Clone, Deserialize)]
pub struct BundleClear {
    /// Machine-readable clear reason.
    pub reason: String,
}

/// A response telling the client that the native app must be updated first.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleNativeUpdateRequired {
    /// The newer bundle build that could not be applied.
    pub bundle_build: u64,
    /// The minimum native build required by that bundle.
    pub min_native_build: u64,
}

/// a struct which indicates how to update only the javascript bundle of the application
#[derive(Debug, Clone, Deserialize)]
#[non_exhaustive]
#[serde(rename_all = "camelCase")]
pub struct BundleUpdate {
    /// the bundle build that we are going to update to
    pub bundle_build: u64,
    /// minimum native build required by this bundle
    pub min_native_build: u64,
    /// some optional notes about the update
    pub notes: Option<String>,
    /// the fully qualified Url where the update bundle exists
    pub url: Url,
    /// the expected SHA-256 hex digest of the downloaded zip file
    pub checksum: String,
}

impl BundleUpdate {
    /// Convert into a download request targeting `destination`, returning a progress receiver.
    pub fn into_download_request<P: AsRef<Path>>(
        self,
        destination: P,
    ) -> (DownloadBundleRequest<P>, Receiver<ProgressPercentage>) {
        let (tx, rx) = channel(MPSC_CHAN_SIZE);
        (
            DownloadBundleRequest {
                url: self.url,
                destination,
                on_progress: tx,
            },
            rx,
        )
    }
}

/// Tracks progress as a numerator/denominator pair.
pub struct Progress {
    numerator: usize,
    denominator: usize,
}

impl Progress {
    /// Create a progress tracker with the given total.
    pub fn from_total(total: usize) -> Self {
        Progress {
            numerator: 0,
            denominator: total,
        }
    }

    /// Increment the numerator by `step`.
    pub fn inc_by(&mut self, step: usize) {
        self.numerator += step;
    }

    /// Set the numerator to an absolute value.
    pub fn set(&mut self, numerator: usize) {
        self.numerator = numerator;
    }

    /// Compute the current percentage (0.0–100.0).
    pub fn percentage(&self) -> ProgressPercentage {
        if self.denominator == 0 {
            return ProgressPercentage(0.0);
        }
        let pct = (self.numerator as f64 / self.denominator as f64) * 100.0;
        ProgressPercentage(pct.clamp(0.0, 100.0))
    }
}

/// represents a [Progress] as a percentage
/// guaranteed to be (0..=100)
#[derive(Debug, Clone, Copy, Default)]
pub struct ProgressPercentage(f64);

impl ProgressPercentage {
    /// 100% progress
    pub fn complete() -> Self {
        Self(100.0)
    }

    /// Get the raw percentage value.
    pub fn value(self) -> f64 {
        self.0
    }
}

/// Parameters for downloading a bundle zip.
#[non_exhaustive]
pub struct DownloadBundleRequest<P> {
    /// URL to download the zip from.
    pub url: Url,
    /// Local path to write the downloaded file.
    pub destination: P,
    /// Channel for streaming download progress.
    pub on_progress: tokio::sync::mpsc::Sender<ProgressPercentage>,
}

/// Errors that can occur during bundle download.
#[derive(Debug, Error)]
pub enum DownloadBundleError {
    /// File I/O failed during download.
    #[error("An error occurred reading the file")]
    FileError,
    /// An unexpected error occurred.
    #[error("An unknown error occurred")]
    OtherError,
}

/// Parameters for extracting a downloaded bundle zip.
#[non_exhaustive]
pub struct UnzipRequest {
    /// the path of the zip file
    pub archive_path: PathBuf,
    /// the path the zip should be extracted to
    pub archive_target: PathBuf,
    /// a sender for the progress of the extraction
    pub on_progress: tokio::sync::mpsc::Sender<ProgressPercentage>,
}

impl UnzipRequest {
    /// Create a new unzip request, returning the request and a progress receiver.
    pub fn new(
        archive_path: PathBuf,
        archive_target: PathBuf,
    ) -> (Self, Receiver<ProgressPercentage>) {
        let (tx, rx) = channel(MPSC_CHAN_SIZE);
        (
            UnzipRequest {
                archive_path,
                archive_target,
                on_progress: tx,
            },
            rx,
        )
    }
}

/// Errors that can occur during bundle extraction.
#[derive(Debug, Error)]
pub enum UnzipError {
    /// The archive file was not found at the expected path.
    #[error("Could not find the archive at {path}")]
    ArchiveNotFound {
        /// The path that was searched.
        path: PathBuf,
    },
    /// SHA-256 digest of the downloaded file did not match.
    #[error("Checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch {
        /// Expected hex digest.
        expected: String,
        /// Actual hex digest.
        actual: String,
    },
    /// An I/O error occurred.
    #[error(transparent)]
    IoErr(#[from] std::io::Error),
    /// An unexpected error occurred.
    #[error("{report}")]
    Other {
        /// The underlying error report.
        report: rootcause::Report,
    },
}

impl From<rootcause::Report> for UnzipError {
    fn from(report: rootcause::Report) -> Self {
        Self::Other { report }
    }
}

/// Top-level errors for the update state machine.
#[derive(Debug, Error)]
pub enum UpdateError {
    /// The download step failed.
    #[error("Failed to download the update")]
    DownloadErr,
    /// Extraction or checksum verification failed.
    #[error("Failed to unzip the update")]
    Unzip,
    /// User approval could not be obtained.
    #[error("Failed to grant permission to update")]
    GrantErr,
    /// A filesystem I/O error occurred.
    #[error("An io error occurred")]
    IoErr,
    /// An unexpected error occurred.
    #[error("An unknown error occurred")]
    Other,
}

/// denotes that an update was approved
#[derive(Debug, Clone, Default)]
pub struct UpdateGranted(());

/// An available update has been found.
#[derive(Debug, Clone)]
pub struct UpdateFoundStatus {
    /// The bundle update metadata.
    pub bundle: BundleUpdate,
}

/// A server-side revocation requires clearing the active bundle root.
#[derive(Debug, Clone)]
pub struct ClearRequiredStatus {
    /// Machine-readable clear reason.
    pub reason: String,
}

/// A newer bundle exists but requires a newer native app build.
#[derive(Debug, Clone)]
pub struct NativeUpdateRequiredStatus {
    /// The newer bundle build that could not be applied.
    pub bundle_build: u64,
    /// The minimum native build required by that bundle.
    pub min_native_build: u64,
}

/// A bundle download is in progress.
#[derive(Debug, Clone)]
pub struct UpdateDownloadingStatus {
    /// Proof that the user approved this download.
    pub grant: UpdateGranted,
    /// The bundle being downloaded.
    pub update: BundleUpdate,
    /// Current download progress.
    pub progress: ProgressPercentage,
}

/// A bundle extraction is in progress.
#[derive(Debug, Clone)]
pub struct UnzipStatus {
    /// Path to the zip archive being extracted.
    pub zip_filename: PathBuf,
    /// Expected bundle build in the extracted manifest.
    pub expected_bundle_build: u64,
    /// Expected minimum native build in the extracted manifest.
    pub expected_min_native_build: u64,
    /// Expected SHA-256 hex digest.
    pub expected_checksum: String,
    /// Current extraction progress.
    pub progress: ProgressPercentage,
}

/// The update has been fully downloaded and extracted.
#[derive(Debug, Clone)]
pub struct CompletedStatus {
    /// Path to the extracted `index.html` entrypoint.
    pub entrypoint: PathBuf,
}

/// Current state of the update state machine.
#[derive(Debug, Clone)]
pub enum UpdateStatus {
    /// No update activity.
    Idle,
    /// Querying the server for available updates.
    CheckingForDownload(AppInfo),
    /// An update is available and awaiting approval.
    UpdateFound(UpdateFoundStatus),
    /// An update is available, but download is deferred until Wi-Fi or Ethernet is available.
    WaitingForWifi(UpdateFoundStatus),
    /// The app is already on the latest version.
    NoUpdateNeeded,
    /// The active cached OTA bundle must be cleared.
    ClearRequired(ClearRequiredStatus),
    /// A newer bundle exists but requires a newer native app build.
    NativeUpdateRequired(NativeUpdateRequiredStatus),
    /// The bundle zip is being downloaded.
    DownloadingBundle(UpdateDownloadingStatus),
    /// The downloaded zip is being extracted.
    UnzippingBundle(UnzipStatus),
    /// The update has been applied successfully.
    Completed(CompletedStatus),
}
