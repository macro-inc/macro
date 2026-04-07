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
        ProgressPercentage((self.numerator as f64 / self.denominator as f64) * 100.0)
    }
}

/// represents a [Progress] as a percentage
/// guaranteed to be (0..=100)
#[derive(Debug, Clone, Copy, Default)]
pub struct ProgressPercentage(f64);

#[non_exhaustive]
pub struct DownloadBundleRequest<P> {
    pub url: Url,
    pub destination: P,
    pub on_progress: tokio::sync::mpsc::Sender<ProgressPercentage>,
}

#[derive(Debug, Error)]
pub enum DownloadBundleError {
    #[error(transparent)]
    FileError(#[from] std::io::Error),
    #[error(transparent)]
    OtherError(#[from] anyhow::Error),
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
    #[error(transparent)]
    IoErr(#[from] std::io::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, Error)]
pub enum UpdateError {
    #[error(transparent)]
    DownloadErr(#[from] DownloadBundleError),
    #[error(transparent)]
    Unzip(#[from] UnzipError),
    #[error(transparent)]
    GrantErr(#[from] GrantErr),
    #[error(transparent)]
    IoErr(#[from] std::io::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// denotes that an update has been found and we are requesting approval
#[derive(Debug, Clone, Copy)]
pub struct UpdateRequested(());
/// denotes that an update was approved via an [UpdateRequested]
#[derive(Debug, Clone)]
pub struct UpdateGranted(());

/// denotes that an update was denied via an [UpdateRequest]
#[derive(Debug, Clone, Copy)]
pub struct UpdateDenied(());

#[derive(Debug, Clone)]
pub enum UpdateApproval {
    Granted(UpdateGranted),
    Denied(UpdateDenied),
}

#[derive(Debug, Error)]
pub enum GrantErr {
    #[error("The update was already either granted or denied")]
    AlreadyGranted,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl UpdateRequested {
    pub(crate) fn new_request() -> Self {
        UpdateRequested(())
    }

    pub fn grant(self) -> UpdateGranted {
        UpdateGranted(())
    }

    pub fn deny(self) -> UpdateDenied {
        UpdateDenied(())
    }
}

#[derive(Debug, Clone)]
pub struct UpdateFoundStatus {
    pub request: UpdateRequested,
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
    UnzipingBundle(UnzipStatus),
    Completed(CompletedStatus),
}
