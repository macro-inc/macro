use rootcause::Report;

use crate::domain::models::{
    AppInfo, BundleUpdate, DownloadBundleError, DownloadBundleRequest, UnzipError, UnzipRequest,
    UpdateApproval, UpdateError, UpdateStatus,
};
use std::path::{Path, PathBuf};

pub trait UpdateRepo: Send + Sync + 'static {
    fn check_for_update(
        &self,
        request: AppInfo,
    ) -> impl Future<Output = Result<Option<BundleUpdate>, rootcause::Report>> + Send;

    fn get_update_bundle<P: AsRef<Path> + Send>(
        &self,
        request: DownloadBundleRequest<P>,
    ) -> impl Future<Output = Result<(), Report<DownloadBundleError>>> + Send;
}

pub trait FsRepo: Send + Sync + 'static {
    fn verify_checksum<P: AsRef<Path> + Send>(
        &self,
        path: P,
        expected: &str,
    ) -> impl Future<Output = Result<(), UnzipError>> + Send;

    fn unzip(
        &self,
        request: UnzipRequest,
    ) -> impl Future<Output = Result<PathBuf, UnzipError>> + Send;

    fn create_dir_all<P: AsRef<Path> + Send>(
        &self,
        path: P,
    ) -> impl Future<Output = Result<(), std::io::Error>> + Send;
}

pub trait SystemQuery: Send + Sync + 'static {
    fn get_system_info(&self) -> impl Future<Output = Result<AppInfo, rootcause::Report>> + Send;
    fn get_update_dir(&self) -> impl Future<Output = Result<PathBuf, std::io::Error>> + Send;
}

pub trait AutoUpdateService: 'static {
    fn status(&self) -> &tokio::sync::watch::Receiver<Result<UpdateStatus, Report<UpdateError>>>;
    /// Try to receive the oneshot sender the worker offered for grant/deny.
    /// Returns `Err` if the worker hasn't offered one yet.
    fn try_recv_grant_sender(
        &mut self,
    ) -> Result<tokio::sync::oneshot::Sender<UpdateApproval>, Report>;
    /// Signal the worker to start the checker loop from Idle.
    fn start(&self) -> Result<(), Report>;
}
