use crate::domain::models::{
    AppInfo, BundleUpdate, DownloadBundleError, DownloadBundleRequest, GrantErr, UnzipError,
    UnzipRequest, UpdateApproval, UpdateError, UpdateStatus,
};
use std::path::{Path, PathBuf};

pub trait UpdateRepo: Send + Sync + 'static {
    fn check_for_update(
        &self,
        request: AppInfo,
    ) -> impl Future<Output = Result<Option<BundleUpdate>, anyhow::Error>> + Send;

    fn get_update_bundle<P: AsRef<Path> + Send>(
        &self,
        request: DownloadBundleRequest<P>,
    ) -> impl Future<Output = Result<(), DownloadBundleError>> + Send;
}

pub trait FsRepo: Send + Sync + 'static {
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
    fn get_system_info(&self) -> impl Future<Output = Result<AppInfo, anyhow::Error>> + Send;
    fn get_update_dir(&self) -> impl Future<Output = Result<PathBuf, std::io::Error>> + Send;
}

pub trait AutoUpdateService: 'static {
    fn status(&self) -> &tokio::sync::watch::Receiver<Result<UpdateStatus, UpdateError>>;
    fn grant_or_deny(&mut self, grant: UpdateApproval) -> Result<(), GrantErr>;
}
