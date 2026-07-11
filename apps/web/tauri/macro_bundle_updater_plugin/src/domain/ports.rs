use rootcause::Report;

use crate::domain::models::{
    AppInfo, BundleAction, DownloadBundleError, DownloadBundleRequest, UnzipError, UnzipRequest,
    UpdateError, UpdateStatus,
};
use std::path::{Path, PathBuf};

/// Port for communicating with the update server.
pub trait UpdateRepo: Send + Sync + 'static {
    /// Check whether a bundle action is available.
    fn check_for_update(
        &self,
        request: AppInfo,
    ) -> impl Future<Output = Result<Option<BundleAction>, rootcause::Report>> + Send;

    /// Download the bundle zip to a local path, streaming progress.
    fn get_update_bundle<P: AsRef<Path> + Send>(
        &self,
        request: DownloadBundleRequest<P>,
    ) -> impl Future<Output = Result<(), Report<DownloadBundleError>>> + Send;
}

/// Port for filesystem operations (checksum, extract, I/O).
pub trait FsRepo: Clone + Send + Sync + 'static {
    /// Verify that the file at `path` has the expected SHA-256 hex digest.
    fn verify_checksum<P: AsRef<Path> + Send>(
        &self,
        path: P,
        expected: &str,
    ) -> impl Future<Output = Result<(), UnzipError>> + Send;

    /// Extract a zip archive, streaming progress.
    fn unzip(
        &self,
        request: UnzipRequest,
    ) -> impl Future<Output = Result<PathBuf, UnzipError>> + Send;

    /// Recursively create directories.
    fn create_dir_all<P: AsRef<Path> + Send>(
        &self,
        path: P,
    ) -> impl Future<Output = Result<(), std::io::Error>> + Send;

    /// List the names of immediate children in `dir`.
    fn list_dir_names(&self, dir: &Path) -> impl Future<Output = Vec<String>> + Send;

    /// Recursively remove a directory.
    fn remove_dir_all(&self, dir: &Path)
    -> impl Future<Output = Result<(), std::io::Error>> + Send;

    /// Read a file's contents as a string.
    fn read_to_string(
        &self,
        path: &Path,
    ) -> impl Future<Output = Result<String, std::io::Error>> + Send;

    /// Write bytes to a file, creating or overwriting it.
    fn write(
        &self,
        path: &Path,
        contents: &[u8],
    ) -> impl Future<Output = Result<(), std::io::Error>> + Send;

    /// Remove a file. Returns `Ok(())` if the file does not exist.
    fn remove_file(&self, path: &Path) -> impl Future<Output = Result<(), std::io::Error>> + Send;
}

/// Port for querying system metadata (version, arch, cache dirs).
pub trait SystemQuery: Send + Sync + 'static {
    /// Return the current app version, architecture, and OS target.
    fn get_system_info(&self) -> impl Future<Output = Result<AppInfo, rootcause::Report>> + Send;
    /// Return the current network type, such as `wifi`, `ethernet`, or `cellular`.
    fn get_network_type(
        &self,
    ) -> impl Future<Output = Result<Option<String>, rootcause::Report>> + Send;
    /// Return the directory where update bundles should be stored.
    fn get_update_dir(&self) -> impl Future<Output = Result<PathBuf, std::io::Error>> + Send;
}

/// Interface for the update service exposed to the plugin layer.
pub trait AutoUpdateService: 'static {
    /// Get a receiver for the current update status.
    fn status(&self) -> &tokio::sync::watch::Receiver<Result<UpdateStatus, Report<UpdateError>>>;

    /// Approve or deny a pending update that has not started downloading.
    fn approve_pending_update(&self, approved: bool) -> Result<(), Report>;
    /// Resume the worker if it is waiting for a Wi-Fi or Ethernet connection.
    fn retry_waiting_for_wifi(&self) -> Result<bool, Report>;
    /// Signal the worker to start the checker loop from Idle.
    fn start(&self) -> Result<(), Report>;
}
