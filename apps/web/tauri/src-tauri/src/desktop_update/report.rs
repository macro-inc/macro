//! Update outcomes for remote telemetry. The host has no exporter of its own,
//! so the frontend drains these reports and sends them on.
//!
//! The schema is closed: versions and code-defined kinds only. Error messages
//! are never copied, because updater and IO errors can carry paths that name
//! the user's home directory.
#![cfg_attr(mobile, allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::Path;

/// Reports kept for a frontend that has not drained them yet.
const CAPACITY: usize = 32;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// When the check or install began, in milliseconds since the epoch.
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    pub started_at_ms: u64,
    /// How long the check took. Zero for an install, which is read back at
    /// the next launch.
    pub duration_ms: u32,
    /// The running app's version.
    pub current_version: String,
    /// Where the running macOS app bundle lives; null on other platforms.
    pub bundle_location: Option<BundleLocation>,
    pub outcome: Outcome,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Outcome {
    /// The feed offers nothing newer.
    UpToDate,
    /// The feed offers a newer version; its download starts now.
    UpdateFound { target_version: String },
    /// The feed offers a newer version built for a newer OS than this
    /// computer runs, so it is not downloaded.
    NeedsNewerOs {
        target_version: String,
        /// The feed's `minimumSystemVersion` for this platform.
        minimum_system_version: String,
    },
    /// The update downloaded and its signature verified. It installs on quit.
    Downloaded {
        target_version: String,
        download_ms: u32,
        #[cfg_attr(test, specta(type = specta_typescript::Number))]
        download_bytes: u64,
    },
    /// Reading the feed failed. Counts every failure since the last success.
    CheckFailed {
        failure: Failure,
        consecutive_failures: u32,
    },
    /// Downloading or verifying the offered update failed.
    DownloadFailed {
        target_version: String,
        download_ms: u32,
        failure: Failure,
        consecutive_failures: u32,
    },
    /// The previous launch installed an update: this launch runs its target
    /// or a later version. `current_version` says which one.
    Installed {
        from_version: String,
        target_version: String,
        trigger: Trigger,
    },
    /// The previous launch tried to install an update and this launch runs
    /// an older version than its target.
    InstallFailed {
        from_version: String,
        target_version: String,
        trigger: Trigger,
        failure: Failure,
    },
}

/// What quit the app and so started the install.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    /// The app quit normally.
    Quit,
    /// The person chose Restart to update.
    Restart,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct Failure {
    pub kind: FailureKind,
    /// `std::io::ErrorKind` by name, such as `PermissionDenied`, for an IO failure.
    pub io_kind: Option<String>,
    /// The HTTP status a feed or download request answered with.
    pub http_status: Option<u16>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// A request timed out.
    Timeout,
    /// No connection to the feed or download host.
    Connect,
    /// A request failed in another way, or answered with an error status.
    Request,
    /// The feed answered without a usable manifest, such as a 404 while it is replaced.
    FeedUnavailable,
    /// The manifest or a version in it did not parse.
    FeedInvalid,
    /// The manifest has no build for this platform.
    PlatformMissing,
    /// The download's signature did not verify.
    Signature,
    /// A file operation failed; `io_kind` names how.
    Io,
    /// macOS asked for an administrator to replace the app and nobody approved.
    Authentication,
    /// The installer rejected the package or its location.
    Install,
    /// The native cache could not be closed before installing.
    CacheShutdown,
    /// The updater is misconfigured in this build.
    Configuration,
    /// The install was started and the app ended without reporting a result.
    Interrupted,
    Other,
}

impl Failure {
    pub fn new(kind: FailureKind) -> Self {
        Self {
            kind,
            io_kind: None,
            http_status: None,
        }
    }

    pub fn io(error: &std::io::Error) -> Self {
        Self {
            io_kind: Some(format!("{:?}", error.kind())),
            ..Self::new(FailureKind::Io)
        }
    }
}

#[cfg(desktop)]
impl From<&tauri_plugin_updater::Error> for Failure {
    fn from(error: &tauri_plugin_updater::Error) -> Self {
        use tauri_plugin_updater::Error;
        match error {
            Error::Reqwest(error) => Self {
                http_status: error.status().map(|status| status.as_u16()),
                ..Self::new(if error.is_timeout() {
                    FailureKind::Timeout
                } else if error.is_connect() {
                    FailureKind::Connect
                } else {
                    FailureKind::Request
                })
            },
            Error::Network(message) => Self {
                http_status: download_status(message),
                ..Self::new(FailureKind::Request)
            },
            Error::Io(error) => Self::io(error),
            Error::ReleaseNotFound => Self::new(FailureKind::FeedUnavailable),
            Error::Serialization(_) | Error::Semver(_) => Self::new(FailureKind::FeedInvalid),
            Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
                Self::new(FailureKind::PlatformMissing)
            }
            Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => {
                Self::new(FailureKind::Signature)
            }
            Error::AuthenticationFailed => Self::new(FailureKind::Authentication),
            Error::TempDirNotOnSameMountPoint
            | Error::BinaryNotFoundInArchive
            | Error::TempDirNotFound
            | Error::FailedToDetermineExtractPath
            | Error::InvalidUpdaterFormat
            | Error::PackageInstallFailed
            | Error::DebInstallFailed => Self::new(FailureKind::Install),
            Error::EmptyEndpoints
            | Error::UnsupportedArch
            | Error::UnsupportedOs
            | Error::UrlParse(_)
            | Error::InsecureTransportProtocol
            | Error::Http(_)
            | Error::InvalidHeaderValue(_)
            | Error::InvalidHeaderName(_) => Self::new(FailureKind::Configuration),
            _ => Self::new(FailureKind::Other),
        }
    }
}

/// The pinned updater reports a failed download only as
/// "Download request failed with status: 404 Not Found".
fn download_status(message: &str) -> Option<u16> {
    let (_, status) = message.rsplit_once("status: ")?;
    status.get(..3)?.parse().ok()
}

/// Where the macOS app bundle runs from. A translocated or mounted copy is
/// read-only, so the updater cannot replace it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum BundleLocation {
    /// `/Applications`.
    Applications,
    /// Gatekeeper's randomized read-only copy of an app opened where it was
    /// downloaded, before anyone moved it.
    Translocated,
    /// A mounted volume, such as the DMG it shipped in.
    MountedVolume,
    /// Anywhere else, such as `~/Applications` or Downloads.
    Elsewhere,
}

impl BundleLocation {
    /// Classifies the path of the executable inside `Name.app/Contents/MacOS`.
    pub fn of_executable(executable: &Path) -> Option<Self> {
        let bundle = executable
            .ancestors()
            .find(|path| path.extension().is_some_and(|extension| extension == "app"))?;
        Some(
            if bundle
                .components()
                .any(|component| component.as_os_str() == "AppTranslocation")
            {
                Self::Translocated
            } else if bundle.starts_with("/Volumes") {
                Self::MountedVolume
            } else if bundle.parent() == Some(Path::new("/Applications")) {
                Self::Applications
            } else {
                Self::Elsewhere
            },
        )
    }

    pub fn current() -> Option<Self> {
        if !cfg!(target_os = "macos") {
            return None;
        }
        Self::of_executable(&std::env::current_exe().ok()?)
    }
}

/// Reports waiting for the frontend, oldest first.
#[derive(Default)]
pub struct Reports {
    queue: VecDeque<Report>,
}

impl Reports {
    pub fn push(&mut self, report: Report) {
        if self.queue.len() == CAPACITY {
            self.queue.pop_front();
        }
        self.queue.push_back(report);
    }

    pub fn take(&mut self) -> Vec<Report> {
        self.queue.drain(..).collect()
    }
}

/// An install the app started as it quit, written before installing so the
/// next launch can report how it ended.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct PendingInstall {
    pub from_version: String,
    pub target_version: String,
    pub trigger: Trigger,
    pub started_at_ms: u64,
    pub failure: Option<Failure>,
}

impl PendingInstall {
    /// Replaces the record whole, so an app killed mid-write leaves the
    /// previous record rather than a truncated one.
    pub fn write(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let partial = path.with_extension("json.partial");
        std::fs::write(&partial, serde_json::to_vec(self)?)?;
        std::fs::rename(&partial, path)
    }

    /// Reads and removes the record a previous launch left, and reports the
    /// install it describes. A record that can't be removed isn't reported,
    /// so it can't report again on every launch.
    pub fn take(
        path: &Path,
        current_version: &str,
        bundle_location: Option<BundleLocation>,
    ) -> Option<Report> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
            Err(error) => {
                tracing::warn!(error = ?error.kind(), "could not read the pending native update install");
                return None;
            }
        };
        if let Err(error) = std::fs::remove_file(path) {
            tracing::warn!(error = ?error.kind(), "could not remove the pending native update install");
            return None;
        }
        let pending = serde_json::from_slice::<Self>(&bytes)
            .inspect_err(|error| {
                tracing::warn!(error = %error, "pending native update install is unreadable");
            })
            .ok()?;
        Some(pending.report(current_version, bundle_location))
    }

    fn report(self, current_version: &str, bundle_location: Option<BundleLocation>) -> Report {
        // A launch on the target or any later version installed; the same or
        // an older copy did not, whatever the record says.
        let installed = match (
            semver::Version::parse(current_version),
            semver::Version::parse(&self.target_version),
        ) {
            (Ok(current), Ok(target)) => current >= target,
            _ => current_version == self.target_version,
        };
        let outcome = if installed {
            Outcome::Installed {
                from_version: self.from_version,
                target_version: self.target_version,
                trigger: self.trigger,
            }
        } else {
            Outcome::InstallFailed {
                from_version: self.from_version,
                target_version: self.target_version,
                trigger: self.trigger,
                failure: self
                    .failure
                    .unwrap_or_else(|| Failure::new(FailureKind::Interrupted)),
            }
        };
        Report {
            started_at_ms: self.started_at_ms,
            duration_ms: 0,
            current_version: current_version.to_owned(),
            bundle_location,
            outcome,
        }
    }
}

#[cfg(test)]
mod test;
