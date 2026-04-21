use serde::Deserialize;
use std::path::{Path, PathBuf};
use strum::IntoStaticStr;
use thiserror::Error;
use tokio::sync::mpsc::{Receiver, channel};
use url::Url;

/// the bounded size of mpsc channels
const MPSC_CHAN_SIZE: usize = 10;

#[derive(Debug, Clone)]
pub struct AppInfo {
    pub current_version: semver::Version,
    pub arch: Arch,
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

/// a struct which indicates how to update only the javascript bundle of the application
#[derive(Debug, Clone, Deserialize)]
#[non_exhaustive]
pub struct BundleUpdate {
    /// the version that we are going to update to
    pub version: semver::Version,
    /// some optional notes about the update
    pub notes: Option<String>,
    /// the fully qualified Url where the update bundle exists
    pub url: Url,
    /// the expected SHA-256 hex digest of the downloaded zip file
    pub checksum: String,
}

impl BundleUpdate {
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

pub struct Progress {
    numerator: usize,
    denominator: usize,
}

impl Progress {
    pub fn from_total(total: usize) -> Self {
        Progress {
            numerator: 0,
            denominator: total,
        }
    }

    pub fn inc_by(&mut self, step: usize) {
        self.numerator += step;
    }

    pub fn set(&mut self, numerator: usize) {
        self.numerator = numerator;
    }

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

    pub fn value(self) -> f64 {
        self.0
    }
}

#[non_exhaustive]
pub struct DownloadBundleRequest<P> {
    pub url: Url,
    pub destination: P,
    pub on_progress: tokio::sync::mpsc::Sender<ProgressPercentage>,
}

#[derive(Debug, Error)]
pub enum DownloadBundleError {
    #[error("An error occurred reading the file")]
    FileError,
    #[error("An unknown error occurred")]
    OtherError,
}

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

#[derive(Debug, Error)]
pub enum UnzipError {
    #[error("Could not find the archive at {path}")]
    ArchiveNotFound { path: PathBuf },
    #[error("Checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },
    #[error(transparent)]
    IoErr(#[from] std::io::Error),
    #[error("{report}")]
    Other { report: rootcause::Report },
}

impl From<rootcause::Report> for UnzipError {
    fn from(report: rootcause::Report) -> Self {
        Self::Other { report }
    }
}

#[derive(Debug, Error)]
pub enum UpdateError {
    #[error("Failed to download the update")]
    DownloadErr,
    #[error("Failed to unzip the update")]
    Unzip,
    #[error("Failed to grant permission to update")]
    GrantErr,
    #[error("An io error occurred")]
    IoErr,
    #[error("An unknown error occurred")]
    Other,
}

/// denotes that an update was approved
#[derive(Debug, Clone)]
pub struct UpdateGranted(());

impl UpdateGranted {
    pub fn new() -> Self {
        UpdateGranted(())
    }
}

/// denotes that an update was denied
#[derive(Debug, Clone, Copy)]
pub struct UpdateDenied(());

impl UpdateDenied {
    pub fn new() -> Self {
        UpdateDenied(())
    }
}

#[derive(Debug, Clone)]
pub enum UpdateApproval {
    Granted(UpdateGranted),
    Denied(UpdateDenied),
}

#[derive(Debug, Clone)]
pub struct UpdateFoundStatus {
    pub bundle: BundleUpdate,
}

#[derive(Debug, Clone)]
pub struct UpdateDownloadingStatus {
    pub grant: UpdateGranted,
    pub update: BundleUpdate,
    pub progress: ProgressPercentage,
}

#[derive(Debug, Clone)]
pub struct UnzipStatus {
    pub zip_filename: PathBuf,
    pub expected_checksum: String,
    pub progress: ProgressPercentage,
}

#[derive(Debug, Clone)]
pub struct CompletedStatus {
    pub entrypoint: PathBuf,
}

#[derive(Debug, Clone)]
pub enum UpdateStatus {
    Idle,
    CheckingForDownload(AppInfo),
    UpdateFound(UpdateFoundStatus),
    NoUpdateNeeded,
    DownloadingBundle(UpdateDownloadingStatus),
    UnzippingBundle(UnzipStatus),
    Completed(CompletedStatus),
}
