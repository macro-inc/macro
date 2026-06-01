use crate::domain::{
    models::{
        BundleRoot, CompletedStatus, ProgressPercentage, UnzipRequest, UnzipStatus,
        UpdateDownloadingStatus, UpdateError, UpdateFoundStatus, UpdateGranted, UpdateStatus,
    },
    ports::{AutoUpdateService, FsRepo, SystemQuery, UpdateRepo},
};
use rootcause::{Report, prelude::ResultExt, report};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::sync::mpsc::error::TrySendError;

const RELOAD_DISPATCH_RETRY_DELAY: Duration = Duration::from_secs(5);

/// Manages the update worker and the active bundle root.
pub struct Service<Fs: FsRepo> {
    handle: WorkerHandle,
    fs_repo: Fs,
    bundle_root: BundleRoot,
    reload_pending: bool,
    reload_dispatched_at: Option<Instant>,
}

enum WorkerCommand {
    Restart,
    Continue,
}

/// Result of attempting to apply a completed bundle update.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyUpdateResult {
    /// There is no completed update to apply.
    NoUpdate,
    /// The bundle root was applied, or remains applied, and a reload should be dispatched.
    ReloadNeeded,
    /// The bundle root was already applied and a reload has already been dispatched.
    ReloadAlreadyDispatched,
}

/// Main thread sends on this to start the checker loop.
type StartTx = tokio::sync::mpsc::Sender<WorkerCommand>;
/// Worker receives on this to know when to run the checker loop.
type StartRx = tokio::sync::mpsc::Receiver<WorkerCommand>;

struct Worker<U, Fs, Q> {
    update_repo: U,
    fs_repo: Fs,
    system_query: Q,
    status_tx: tokio::sync::watch::Sender<Result<UpdateStatus, Report<UpdateError>>>,
    start_rx: StartRx,
}

struct WorkerHandle {
    status_rx: tokio::sync::watch::Receiver<Result<UpdateStatus, Report<UpdateError>>>,
    status_tx: tokio::sync::watch::Sender<Result<UpdateStatus, Report<UpdateError>>>,
    start_tx: StartTx,
}

/// the name of the app entrypoint
const ENTRYPOINT_NAME: &str = "index.html";

impl<U: UpdateRepo, Fs: FsRepo, Q: SystemQuery> Worker<U, Fs, Q> {
    fn new_handle(update_repo: U, fs_repo: Fs, system_query: Q) -> WorkerHandle {
        let (status_tx, status_rx) = tokio::sync::watch::channel(Ok(UpdateStatus::Idle));
        let (start_tx, start_rx) = tokio::sync::mpsc::channel(1);

        Worker {
            update_repo,
            fs_repo,
            system_query,
            status_tx: status_tx.clone(),
            start_rx,
        }
        .run_background();

        WorkerHandle {
            status_rx,
            status_tx,
            start_tx,
        }
    }

    fn run_background(mut self) {
        tauri::async_runtime::spawn(async move {
            // Run the checker loop once on startup, then again each time we
            // receive a restart signal from the main thread.
            while let Some(command) = self.start_rx.recv().await {
                if matches!(command, WorkerCommand::Restart) {
                    // Reset status to Idle for the new run.
                    if self.status_tx.send(Ok(UpdateStatus::Idle)).is_err() {
                        break;
                    }
                }

                self.run_check_loop().await;
            }
        });
    }

    async fn run_check_loop(&mut self) {
        loop {
            let Ok(status) = self.status_tx.borrow().as_ref().cloned() else {
                break;
            };
            if let UpdateStatus::NoUpdateNeeded | UpdateStatus::Completed(_) = status {
                break;
            }

            let next = self.next_status(status).await;
            let should_stop = matches!(
                &next,
                Ok(UpdateStatus::NoUpdateNeeded)
                    | Ok(UpdateStatus::WaitingForWifi(_))
                    | Ok(UpdateStatus::Completed(_))
                    | Err(_)
            );

            let Ok(()) = self.status_tx.send(next) else {
                break;
            };
            if should_stop {
                break;
            }
        }
    }

    #[tracing::instrument(ret, err, skip(self))]
    async fn next_status(
        &mut self,
        status: UpdateStatus,
    ) -> Result<UpdateStatus, Report<UpdateError>> {
        match status {
            UpdateStatus::Idle => {
                let app_info = self
                    .system_query
                    .get_system_info()
                    .await
                    .context(UpdateError::Other)?;

                Ok(UpdateStatus::CheckingForDownload(app_info))
            }
            UpdateStatus::CheckingForDownload(app_info) => {
                let res = self
                    .update_repo
                    .check_for_update(app_info)
                    .await
                    .context(UpdateError::DownloadErr)?;

                match res {
                    Some(update) => {
                        // Check if this version was already downloaded in a previous session.
                        if let Ok(update_dir) = self.system_query.get_update_dir().await
                            && let Some(entrypoint) =
                                find_cached_bundle(&self.fs_repo, &update_dir, &update.version)
                                    .await
                        {
                            return Ok(UpdateStatus::Completed(CompletedStatus { entrypoint }));
                        }
                        Ok(UpdateStatus::UpdateFound(UpdateFoundStatus {
                            bundle: update,
                        }))
                    }
                    None => Ok(UpdateStatus::NoUpdateNeeded),
                }
            }
            UpdateStatus::UpdateFound(update_found_status) => {
                match self.should_download_now().await {
                    Ok(true) => Ok(start_download(update_found_status)),
                    Ok(false) => Ok(UpdateStatus::WaitingForWifi(update_found_status)),
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            "Network check failed; waiting for Wi-Fi"
                        );
                        Ok(UpdateStatus::WaitingForWifi(update_found_status))
                    }
                }
            }
            UpdateStatus::WaitingForWifi(update_found_status) => {
                match self.should_download_now().await {
                    Ok(true) => Ok(start_download(update_found_status)),
                    Ok(false) => Ok(UpdateStatus::WaitingForWifi(update_found_status)),
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            "Network check failed while waiting for Wi-Fi"
                        );
                        Ok(UpdateStatus::WaitingForWifi(update_found_status))
                    }
                }
            }
            UpdateStatus::NoUpdateNeeded => Ok(UpdateStatus::NoUpdateNeeded),
            UpdateStatus::DownloadingBundle(status) => {
                let update_dir = self
                    .system_query
                    .get_update_dir()
                    .await
                    .context(UpdateError::IoErr)?;

                let download_filename = self
                    .create_download_directory(update_dir)
                    .await
                    .context(UpdateError::IoErr)?;

                let expected_checksum = status.update.checksum.clone();
                let (req, rx) = status.update.into_download_request(&download_filename);

                let status_tx = self.status_tx.clone();
                tokio::task::spawn(glue_channels(rx, status_tx, |cur, progress| match cur {
                    UpdateStatus::DownloadingBundle(download) => {
                        download.progress = progress;
                        true
                    }
                    _ => false,
                }));

                let () = self
                    .update_repo
                    .get_update_bundle(req)
                    .await
                    .context(UpdateError::DownloadErr)?;
                Ok(UpdateStatus::UnzippingBundle(UnzipStatus {
                    zip_filename: download_filename,
                    expected_checksum,
                    progress: ProgressPercentage::default(),
                }))
            }
            UpdateStatus::UnzippingBundle(unzip_status) => {
                self.fs_repo
                    .verify_checksum(&unzip_status.zip_filename, &unzip_status.expected_checksum)
                    .await
                    .context(UpdateError::Unzip)?;

                let archive_target = unzip_status
                    .zip_filename
                    .parent()
                    .unwrap_or(&unzip_status.zip_filename)
                    .to_path_buf();
                let (req, rx) = UnzipRequest::new(unzip_status.zip_filename, archive_target);

                let status_tx = self.status_tx.clone();
                tokio::task::spawn(glue_channels(rx, status_tx, |cur, progress| match cur {
                    UpdateStatus::UnzippingBundle(zip) => {
                        zip.progress = progress;
                        true
                    }
                    _ => false,
                }));

                let mut entrypoint = self.fs_repo.unzip(req).await.context(UpdateError::Unzip)?;
                entrypoint.push(ENTRYPOINT_NAME);
                Ok(UpdateStatus::Completed(CompletedStatus { entrypoint }))
            }
            UpdateStatus::Completed(x) => Ok(UpdateStatus::Completed(x)),
        }
    }

    async fn should_download_now(&self) -> Result<bool, Report> {
        let network_type = self.system_query.get_network_type().await?;
        tracing::info!(
            network_type = network_type.as_deref().unwrap_or("unknown"),
            "Bundle update network check"
        );
        Ok(matches!(
            network_type.as_deref(),
            Some("wifi") | Some("ethernet")
        ))
    }

    /// Create a monotonically increasing download directory and return the
    /// path where the zip should be placed.
    async fn create_download_directory(
        &self,
        mut bundle: PathBuf,
    ) -> Result<PathBuf, std::io::Error> {
        let next = next_bundle_index(&self.fs_repo.list_dir_names(&bundle).await);
        bundle.push(next.to_string());
        self.fs_repo.create_dir_all(&bundle).await?;
        bundle.push("bundle.zip");
        Ok(bundle)
    }
}

fn start_download(update_found_status: UpdateFoundStatus) -> UpdateStatus {
    UpdateStatus::DownloadingBundle(UpdateDownloadingStatus {
        grant: UpdateGranted::default(),
        update: update_found_status.bundle,
        progress: ProgressPercentage::default(),
    })
}

/// Determine the next monotonic bundle index from a list of directory names.
pub(crate) fn next_bundle_index(names: &[String]) -> u64 {
    names
        .iter()
        .filter_map(|n| n.parse::<u64>().ok())
        .max()
        .map_or(0, |m| m + 1)
}

/// Search existing numeric bundle directories for one whose `semver.txt`
/// matches `version`. Returns the entrypoint path if found.
async fn find_cached_bundle(
    fs: &impl FsRepo,
    update_dir: &std::path::Path,
    version: &semver::Version,
) -> Option<PathBuf> {
    let version_str = version.to_string();
    let names = fs.list_dir_names(update_dir).await;
    tracing::info!(
        "find_cached_bundle: looking for version {version_str} in {update_dir:?}, found dirs: {names:?}"
    );
    for name in names {
        if name.parse::<u64>().is_err() {
            continue;
        }
        let dir = update_dir.join(&name);
        let semver_path = dir.join("semver.txt");
        match fs.read_to_string(&semver_path).await {
            Ok(contents) => {
                tracing::info!(
                    "find_cached_bundle: {semver_path:?} contains {:?}, want {version_str:?}",
                    contents.trim()
                );
                if contents.trim() == version_str {
                    let entrypoint = dir.join(ENTRYPOINT_NAME);
                    if fs.read_to_string(&entrypoint).await.is_ok() {
                        tracing::info!("find_cached_bundle: hit — reusing {entrypoint:?}");
                        return Some(entrypoint);
                    }
                }
            }
            Err(e) => {
                tracing::debug!("find_cached_bundle: no semver.txt in {dir:?}: {e}");
            }
        }
    }
    tracing::info!("find_cached_bundle: no cached bundle found for {version_str}");
    None
}

/// helper function which pipes the progress of an event from one channel into another
/// returning true if the value in the sender channel was modified
async fn glue_channels<F>(
    mut rx: tokio::sync::mpsc::Receiver<ProgressPercentage>,
    status_tx: tokio::sync::watch::Sender<Result<UpdateStatus, Report<UpdateError>>>,
    mut f: F,
) where
    F: FnMut(&mut UpdateStatus, ProgressPercentage) -> bool + 'static + Send,
{
    while let Some(progress) = rx.recv().await {
        status_tx.send_if_modified(|cur| match cur {
            Ok(r) => f(r, progress),
            Err(_) => false,
        });
    }
}

impl<Fs: FsRepo> Service<Fs> {
    /// Create a new service, spawning the background update worker.
    pub fn new<U: UpdateRepo, Q: SystemQuery>(
        update_repo: U,
        fs_repo: Fs,
        system_query: Q,
    ) -> Self {
        let handle = Worker::new_handle(update_repo, fs_repo.clone(), system_query);
        Service {
            handle,
            fs_repo,
            bundle_root: BundleRoot::new(),
            reload_pending: false,
            reload_dispatched_at: None,
        }
    }

    /// Load persisted bundle root from the given cache directory.
    pub async fn load_bundle_root(&mut self, cache_dir: &Path) {
        self.bundle_root = BundleRoot::load(cache_dir, &self.fs_repo).await;
    }

    /// Get the current bundle root path, if an OTA update has been applied.
    pub fn bundle_root_path(&self) -> Option<&Path> {
        self.bundle_root.path()
    }

    /// Apply the update by modifying the bundle root.
    ///
    /// Returns `Ok(ReloadNeeded)` when a webview reload should be dispatched.
    /// The worker remains in `Completed` until the reloaded webview acknowledges
    /// that it mounted with the new bundle root.
    pub async fn apply_update(&mut self, cache_dir: &Path) -> Result<ApplyUpdateResult, Report> {
        if self.reload_pending {
            return Ok(if self.reload_dispatched_at.is_some() {
                ApplyUpdateResult::ReloadAlreadyDispatched
            } else {
                ApplyUpdateResult::ReloadNeeded
            });
        }

        let entrypoint = {
            let status = self.status().borrow();
            match status.as_ref() {
                Ok(UpdateStatus::Completed(bundle_location)) => bundle_location.entrypoint.clone(),
                _ => return Ok(ApplyUpdateResult::NoUpdate),
            }
        };

        let bundle_dir = entrypoint
            .parent()
            .ok_or_else(|| report!("entrypoint {entrypoint:?} has no parent directory"))?
            .to_path_buf();

        tracing::info!("Setting bundle root to {bundle_dir:?}");
        self.set_bundle_root(bundle_dir.clone(), cache_dir).await?;
        self.reload_pending = true;
        self.reload_dispatched_at = None;

        // Remove old bundle directories now that we've switched to the new one
        self.cleanup_old_bundles(cache_dir, &bundle_dir).await;

        Ok(ApplyUpdateResult::ReloadNeeded)
    }

    /// Record that the pending reload was successfully dispatched to the webview.
    pub fn mark_update_reload_dispatched(&mut self) {
        if self.reload_pending {
            self.reload_dispatched_at = Some(Instant::now());
        }
    }

    /// Clear a pending reload dispatch marker after dispatch failed synchronously.
    pub fn unmark_update_reload_dispatched(&mut self) -> bool {
        if !self.reload_pending || self.reload_dispatched_at.is_none() {
            return false;
        }

        self.reload_dispatched_at = None;
        true
    }

    /// Allow a stale pending reload dispatch to be attempted again.
    pub fn allow_update_reload_retry(&mut self) -> bool {
        if !self.reload_pending || self.reload_dispatched_at.is_none() {
            return false;
        }

        if self
            .reload_dispatched_at
            .is_some_and(|dispatched_at| dispatched_at.elapsed() < RELOAD_DISPATCH_RETRY_DELAY)
        {
            return false;
        }

        self.reload_dispatched_at = None;
        true
    }

    /// Acknowledge that the webview has reloaded after applying an update.
    ///
    /// Returns `Ok(true)` if a pending reload was acknowledged and the updater
    /// worker was nudged to check again, or `Ok(false)` when no reload was pending.
    pub fn acknowledge_update_reload(&mut self) -> Result<bool, Report> {
        if !self.reload_pending {
            return Ok(false);
        }

        self.restart_run_after_reload_ack()?;
        self.reload_pending = false;
        self.reload_dispatched_at = None;
        Ok(true)
    }

    /// Set the bundle root to a new directory and persist it.
    ///
    /// The in-memory state is only updated after persistence succeeds.
    async fn set_bundle_root(
        &mut self,
        path: PathBuf,
        cache_dir: &Path,
    ) -> Result<(), std::io::Error> {
        // Persist first — only commit in-memory if the write succeeds.
        let new_root = BundleRoot::from_path(path);
        new_root.persist(cache_dir, &self.fs_repo).await?;
        self.bundle_root = new_root;
        Ok(())
    }

    /// Clear the bundle root and remove all downloaded bundles.
    pub async fn clear_bundle_root(&mut self, cache_dir: &Path) -> Result<(), std::io::Error> {
        for name in self.fs_repo.list_dir_names(cache_dir).await {
            if name.parse::<u64>().is_ok() {
                let _ = self.fs_repo.remove_dir_all(&cache_dir.join(&name)).await;
            }
        }
        self.bundle_root.clear();
        self.bundle_root.persist(cache_dir, &self.fs_repo).await
    }

    /// Read the bundle version from `semver.txt` inside the current bundle root.
    pub async fn bundle_version(&self) -> Option<semver::Version> {
        self.bundle_root.version(&self.fs_repo).await
    }

    /// Remove all numeric bundle subdirectories under `dir` except `keep`.
    async fn cleanup_old_bundles(&self, dir: &Path, keep: &Path) {
        for name in self.fs_repo.list_dir_names(dir).await {
            if name.parse::<u64>().is_err() {
                continue;
            }
            let path = dir.join(&name);
            if path == keep {
                continue;
            }
            if let Err(e) = self.fs_repo.remove_dir_all(&path).await {
                tracing::warn!(error=?e, "Failed to remove old bundle directory {path:?}");
            }
        }
    }
}

impl<Fs: FsRepo> AutoUpdateService for Service<Fs> {
    fn status(&self) -> &tokio::sync::watch::Receiver<Result<UpdateStatus, Report<UpdateError>>> {
        &self.handle.status_rx
    }

    fn approve_pending_update(&self, approved: bool) -> Result<(), Report> {
        let mut updated = false;
        self.handle.status_tx.send_if_modified(|cur| {
            let Ok(status) = cur else {
                return false;
            };
            let pending = match status {
                UpdateStatus::UpdateFound(found) | UpdateStatus::WaitingForWifi(found) => {
                    Some(found.clone())
                }
                _ => None,
            };
            let Some(found) = pending else {
                return false;
            };

            *status = if approved {
                start_download(found)
            } else {
                UpdateStatus::NoUpdateNeeded
            };
            updated = true;
            true
        });

        if !updated {
            return Err(report!("No pending bundle update to approve"));
        }

        if approved {
            self.continue_run()?;
        }
        Ok(())
    }

    fn retry_waiting_for_wifi(&self) -> Result<bool, Report> {
        let waiting = matches!(
            &*self.handle.status_rx.borrow(),
            Ok(UpdateStatus::WaitingForWifi(_))
        );
        if waiting {
            self.continue_run()?;
        }
        Ok(waiting)
    }

    #[tracing::instrument(err, skip(self))]
    fn start(&self) -> Result<(), Report> {
        self.handle
            .start_tx
            .try_send(WorkerCommand::Restart)
            .map_err(|e| report!("Failed to send start signal: {e}"))
    }
}

impl<Fs: FsRepo> Service<Fs> {
    fn continue_run(&self) -> Result<(), Report> {
        match self.handle.start_tx.try_send(WorkerCommand::Continue) {
            Ok(()) | Err(TrySendError::Full(_)) => Ok(()),
            Err(e) => Err(report!("Failed to send continue signal: {e}")),
        }
    }

    fn restart_run_after_reload_ack(&self) -> Result<(), Report> {
        self.handle
            .status_tx
            .send(Ok(UpdateStatus::Idle))
            .map_err(|e| report!("Failed to reset bundle update status: {e}"))?;
        self.continue_run()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        models::{
            AppInfo, Arch, BundleUpdate, DownloadBundleError, DownloadBundleRequest, Target,
            UnzipError,
        },
        ports::AutoUpdateService,
    };
    use std::{
        future::pending,
        sync::{Arc, Mutex as StdMutex},
        time::Duration,
    };

    #[derive(Clone)]
    struct FakeUpdateRepo {
        update: Option<BundleUpdate>,
        block_download: bool,
    }

    impl UpdateRepo for FakeUpdateRepo {
        async fn check_for_update(
            &self,
            _request: AppInfo,
        ) -> Result<Option<BundleUpdate>, rootcause::Report> {
            Ok(self.update.clone())
        }

        async fn get_update_bundle<P: AsRef<Path> + Send>(
            &self,
            _request: DownloadBundleRequest<P>,
        ) -> Result<(), Report<DownloadBundleError>> {
            if self.block_download {
                pending::<()>().await;
            }
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct FakeFs;

    impl FsRepo for FakeFs {
        async fn verify_checksum<P: AsRef<Path> + Send>(
            &self,
            _path: P,
            _expected: &str,
        ) -> Result<(), UnzipError> {
            Ok(())
        }

        async fn unzip(&self, request: UnzipRequest) -> Result<PathBuf, UnzipError> {
            Ok(request.archive_target)
        }

        async fn create_dir_all<P: AsRef<Path> + Send>(
            &self,
            _path: P,
        ) -> Result<(), std::io::Error> {
            Ok(())
        }

        async fn list_dir_names(&self, _dir: &Path) -> Vec<String> {
            Vec::new()
        }

        async fn remove_dir_all(&self, _dir: &Path) -> Result<(), std::io::Error> {
            Ok(())
        }

        async fn read_to_string(&self, _path: &Path) -> Result<String, std::io::Error> {
            Err(std::io::Error::new(std::io::ErrorKind::NotFound, "missing"))
        }

        async fn write(&self, _path: &Path, _contents: &[u8]) -> Result<(), std::io::Error> {
            Ok(())
        }

        async fn remove_file(&self, _path: &Path) -> Result<(), std::io::Error> {
            Ok(())
        }
    }

    #[derive(Clone)]
    struct FakeSystemQuery {
        network_type: Arc<StdMutex<Option<String>>>,
        network_type_error: Arc<StdMutex<bool>>,
        update_dir: PathBuf,
    }

    impl FakeSystemQuery {
        fn new(network_type: &str) -> Self {
            Self {
                network_type: Arc::new(StdMutex::new(Some(network_type.to_string()))),
                network_type_error: Arc::new(StdMutex::new(false)),
                update_dir: std::env::temp_dir().join("macro_bundle_updater_plugin_tests"),
            }
        }

        fn set_network_type(&self, network_type: &str) {
            *self.network_type.lock().unwrap() = Some(network_type.to_string());
        }

        fn set_network_type_error(&self, should_error: bool) {
            *self.network_type_error.lock().unwrap() = should_error;
        }
    }

    impl SystemQuery for FakeSystemQuery {
        async fn get_system_info(&self) -> Result<AppInfo, rootcause::Report> {
            Ok(AppInfo {
                current_version: semver::Version::new(0, 0, 0),
                arch: Arch::Aarch64,
                target: Target::Ios,
            })
        }

        async fn get_network_type(&self) -> Result<Option<String>, rootcause::Report> {
            if *self.network_type_error.lock().unwrap() {
                return Err(report!("network info unavailable"));
            }
            Ok(self.network_type.lock().unwrap().clone())
        }

        async fn get_update_dir(&self) -> Result<PathBuf, std::io::Error> {
            Ok(self.update_dir.clone())
        }
    }

    fn bundle_update() -> BundleUpdate {
        BundleUpdate {
            version: semver::Version::new(1, 2, 3),
            notes: None,
            url: "https://example.com/bundle.zip".parse().unwrap(),
            checksum: "checksum".to_string(),
        }
    }

    fn service_with_network(network_type: &str) -> (Service<FakeFs>, FakeSystemQuery) {
        let system_query = FakeSystemQuery::new(network_type);
        let service = Service::new(
            FakeUpdateRepo {
                update: Some(bundle_update()),
                block_download: true,
            },
            FakeFs,
            system_query.clone(),
        );
        (service, system_query)
    }

    fn service_with_status(status: UpdateStatus) -> (Service<FakeFs>, StartRx) {
        let (status_tx, status_rx) = tokio::sync::watch::channel(Ok(status));
        let (start_tx, start_rx) = tokio::sync::mpsc::channel(1);
        (
            Service {
                handle: WorkerHandle {
                    status_rx,
                    status_tx,
                    start_tx,
                },
                fs_repo: FakeFs,
                bundle_root: BundleRoot::new(),
                reload_pending: false,
                reload_dispatched_at: None,
            },
            start_rx,
        )
    }

    fn completed_status() -> UpdateStatus {
        UpdateStatus::Completed(CompletedStatus {
            entrypoint: PathBuf::from("/tmp/macro-bundle-test/1/index.html"),
        })
    }

    async fn wait_for_status(
        service: &Service<FakeFs>,
        mut predicate: impl FnMut(&UpdateStatus) -> bool,
    ) -> UpdateStatus {
        let mut rx = service.status().clone();
        tokio::time::timeout(Duration::from_secs(1), async move {
            loop {
                {
                    let borrowed = rx.borrow();
                    if let Ok(status) = &*borrowed
                        && predicate(status)
                    {
                        return status.clone();
                    }
                }
                rx.changed().await.expect("status sender dropped");
            }
        })
        .await
        .expect("timed out waiting for status")
    }

    #[tokio::test]
    async fn update_found_on_wifi_advances_to_downloading() {
        let (service, _system_query) = service_with_network("wifi");

        service.start().unwrap();

        let status = wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::DownloadingBundle(_))
        })
        .await;
        assert!(matches!(status, UpdateStatus::DownloadingBundle(_)));
    }

    #[tokio::test]
    async fn update_found_on_ethernet_advances_to_downloading() {
        let (service, _system_query) = service_with_network("ethernet");

        service.start().unwrap();

        let status = wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::DownloadingBundle(_))
        })
        .await;
        assert!(matches!(status, UpdateStatus::DownloadingBundle(_)));
    }

    #[tokio::test]
    async fn update_found_on_cellular_waits_for_wifi() {
        let (service, _system_query) = service_with_network("cellular");

        service.start().unwrap();

        let status = wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::WaitingForWifi(_))
        })
        .await;
        assert!(matches!(status, UpdateStatus::WaitingForWifi(_)));
    }

    #[tokio::test]
    async fn retry_waiting_for_wifi_stays_waiting_on_cellular() {
        let (service, _system_query) = service_with_network("cellular");

        service.start().unwrap();
        wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::WaitingForWifi(_))
        })
        .await;

        assert!(service.retry_waiting_for_wifi().unwrap());
        let status = wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::WaitingForWifi(_))
        })
        .await;
        assert!(matches!(status, UpdateStatus::WaitingForWifi(_)));
    }

    #[tokio::test]
    async fn retry_waiting_for_wifi_advances_when_wifi_becomes_available() {
        let (service, system_query) = service_with_network("cellular");

        service.start().unwrap();
        wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::WaitingForWifi(_))
        })
        .await;

        system_query.set_network_type("wifi");
        assert!(service.retry_waiting_for_wifi().unwrap());

        let status = wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::DownloadingBundle(_))
        })
        .await;
        assert!(matches!(status, UpdateStatus::DownloadingBundle(_)));
    }

    #[tokio::test]
    async fn retry_waiting_for_wifi_stays_waiting_when_network_check_fails() {
        let (service, system_query) = service_with_network("cellular");

        service.start().unwrap();
        wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::WaitingForWifi(_))
        })
        .await;

        system_query.set_network_type_error(true);
        assert!(service.retry_waiting_for_wifi().unwrap());

        let status = wait_for_status(&service, |status| {
            matches!(status, UpdateStatus::WaitingForWifi(_))
        })
        .await;
        assert!(matches!(status, UpdateStatus::WaitingForWifi(_)));
    }

    #[tokio::test]
    async fn duplicate_retry_nudge_is_benign_when_command_already_queued() {
        let (status_tx, status_rx) =
            tokio::sync::watch::channel(Ok(UpdateStatus::WaitingForWifi(UpdateFoundStatus {
                bundle: bundle_update(),
            })));
        let (start_tx, _start_rx) = tokio::sync::mpsc::channel(1);
        start_tx.try_send(WorkerCommand::Continue).unwrap();
        let service = Service {
            handle: WorkerHandle {
                status_rx,
                status_tx,
                start_tx,
            },
            fs_repo: FakeFs,
            bundle_root: BundleRoot::new(),
            reload_pending: false,
            reload_dispatched_at: None,
        };

        assert!(service.retry_waiting_for_wifi().unwrap());
    }

    #[tokio::test]
    async fn apply_update_returns_no_update_when_status_is_not_completed() {
        let (mut service, _system_query) = service_with_network("wifi");

        let applied = service.apply_update(Path::new("/tmp")).await.unwrap();

        assert_eq!(applied, ApplyUpdateResult::NoUpdate);
    }

    #[tokio::test]
    async fn apply_update_keeps_worker_completed_until_reload_ack() {
        let (mut service, mut start_rx) = service_with_status(completed_status());

        let applied = service.apply_update(Path::new("/tmp")).await.unwrap();

        assert_eq!(applied, ApplyUpdateResult::ReloadNeeded);
        assert!(service.reload_pending);
        assert!(service.reload_dispatched_at.is_none());
        assert!(matches!(
            &*service.status().borrow(),
            Ok(UpdateStatus::Completed(_))
        ));
        assert!(start_rx.try_recv().is_err());

        assert!(service.acknowledge_update_reload().unwrap());
        assert!(!service.reload_pending);
        assert!(service.reload_dispatched_at.is_none());
        assert!(matches!(
            &*service.status().borrow(),
            Ok(UpdateStatus::Idle)
        ));
        assert!(matches!(
            start_rx.try_recv().unwrap(),
            WorkerCommand::Continue
        ));
    }

    #[tokio::test]
    async fn apply_update_requests_reload_while_dispatch_is_pending() {
        let (mut service, _start_rx) = service_with_status(UpdateStatus::Idle);
        service.reload_pending = true;

        let applied = service.apply_update(Path::new("/tmp")).await.unwrap();

        assert_eq!(applied, ApplyUpdateResult::ReloadNeeded);
    }

    #[tokio::test]
    async fn apply_update_does_not_request_second_reload_after_dispatch() {
        let (mut service, _start_rx) = service_with_status(completed_status());

        let applied = service.apply_update(Path::new("/tmp")).await.unwrap();
        assert_eq!(applied, ApplyUpdateResult::ReloadNeeded);

        service.mark_update_reload_dispatched();

        let applied = service.apply_update(Path::new("/tmp")).await.unwrap();
        assert_eq!(applied, ApplyUpdateResult::ReloadAlreadyDispatched);
    }

    #[tokio::test]
    async fn allow_update_reload_retry_waits_for_stale_dispatch() {
        let (mut service, _start_rx) = service_with_status(completed_status());

        let applied = service.apply_update(Path::new("/tmp")).await.unwrap();
        assert_eq!(applied, ApplyUpdateResult::ReloadNeeded);

        service.mark_update_reload_dispatched();
        assert_eq!(
            service.apply_update(Path::new("/tmp")).await.unwrap(),
            ApplyUpdateResult::ReloadAlreadyDispatched
        );

        assert!(!service.allow_update_reload_retry());
        service.reload_dispatched_at = Some(Instant::now() - RELOAD_DISPATCH_RETRY_DELAY);

        assert!(service.allow_update_reload_retry());
        assert!(service.reload_dispatched_at.is_none());
        assert_eq!(
            service.apply_update(Path::new("/tmp")).await.unwrap(),
            ApplyUpdateResult::ReloadNeeded
        );
    }

    #[tokio::test]
    async fn unmark_update_reload_dispatched_bypasses_stale_retry_gate() {
        let (mut service, _start_rx) = service_with_status(completed_status());

        let applied = service.apply_update(Path::new("/tmp")).await.unwrap();
        assert_eq!(applied, ApplyUpdateResult::ReloadNeeded);

        service.mark_update_reload_dispatched();
        assert_eq!(
            service.apply_update(Path::new("/tmp")).await.unwrap(),
            ApplyUpdateResult::ReloadAlreadyDispatched
        );

        assert!(service.unmark_update_reload_dispatched());
        assert_eq!(
            service.apply_update(Path::new("/tmp")).await.unwrap(),
            ApplyUpdateResult::ReloadNeeded
        );
    }

    #[test]
    fn acknowledge_update_reload_returns_false_without_pending_reload() {
        let (mut service, _start_rx) = service_with_status(UpdateStatus::Idle);

        assert!(!service.acknowledge_update_reload().unwrap());
    }

    #[test]
    fn acknowledge_update_reload_treats_full_command_queue_as_acknowledged() {
        let (mut service, _start_rx) = service_with_status(UpdateStatus::Idle);
        service.reload_pending = true;
        service
            .handle
            .start_tx
            .try_send(WorkerCommand::Continue)
            .unwrap();

        assert!(service.acknowledge_update_reload().unwrap());
        assert!(!service.reload_pending);
        assert!(service.reload_dispatched_at.is_none());
        assert!(matches!(
            &*service.status().borrow(),
            Ok(UpdateStatus::Idle)
        ));
    }
}
