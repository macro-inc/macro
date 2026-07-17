use crate::domain::{
    bundle_routes::{BundleRoutes, BundleSource, BundleSourceKind},
    models::{
        AppInfo, BundleAction, BundleManifest, BundleRoot, ClearRequiredStatus, CompletedStatus,
        NativeUpdateRequiredStatus, ProgressPercentage, UnzipRequest, UnzipStatus,
        UpdateDownloadingStatus, UpdateError, UpdateFoundStatus, UpdateGranted, UpdateStatus,
    },
    ports::{AutoUpdateService, FsRepo, SystemQuery, TaskSpawner, UpdateRepo},
};
use rootcause::{Report, prelude::ResultExt, report};
use std::{
    marker::PhantomData,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::sync::mpsc::error::TrySendError;

const RELOAD_DISPATCH_RETRY_DELAY: Duration = Duration::from_secs(5);

/// Manages the update worker and the active bundle root.
pub struct Service<Fs: FsRepo> {
    handle: WorkerHandle,
    fs_repo: Fs,
    embedded_bundle_build: u64,
    native_build: u64,
    bundle_root: BundleRoot,
    bundle_routes: BundleRoutes,
    pending_reload_bundle_build: Option<u64>,
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

struct Worker<U, Fs, Q, S> {
    update_repo: U,
    fs_repo: Fs,
    system_query: Q,
    bundle_routes: BundleRoutes,
    _task_spawner: PhantomData<S>,
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
const PENDING_BUNDLE_ROOT_FILE: &str = "pending_bundle_root";

impl<U: UpdateRepo, Fs: FsRepo, Q: SystemQuery, S: TaskSpawner> Worker<U, Fs, Q, S> {
    fn new_handle(
        update_repo: U,
        fs_repo: Fs,
        system_query: Q,
        bundle_routes: BundleRoutes,
    ) -> WorkerHandle {
        let (status_tx, status_rx) = tokio::sync::watch::channel(Ok(UpdateStatus::Idle));
        let (start_tx, start_rx) = tokio::sync::mpsc::channel(1);

        Worker {
            update_repo,
            fs_repo,
            system_query,
            bundle_routes,
            _task_spawner: PhantomData::<S>,
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

    fn run_background(self) {
        S::spawn(async move {
            let mut worker = self;
            // Run the checker loop once on startup, then again each time we
            // receive a restart signal from the main thread.
            while let Some(command) = worker.start_rx.recv().await {
                if matches!(command, WorkerCommand::Restart) {
                    // Reset status to Idle for the new run.
                    if worker.status_tx.send(Ok(UpdateStatus::Idle)).is_err() {
                        break;
                    }
                }

                worker.run_check_loop().await;
            }
        });
    }

    async fn run_check_loop(&mut self) {
        loop {
            let Ok(status) = self.status_tx.borrow().as_ref().cloned() else {
                break;
            };
            if let UpdateStatus::NoUpdateNeeded
            | UpdateStatus::Completed(_)
            | UpdateStatus::ClearRequired(_)
            | UpdateStatus::NativeUpdateRequired(_) = status
            {
                break;
            }

            let next = self.next_status(status).await;
            let should_stop = matches!(
                &next,
                Ok(UpdateStatus::NoUpdateNeeded)
                    | Ok(UpdateStatus::WaitingForWifi(_))
                    | Ok(UpdateStatus::Completed(_))
                    | Ok(UpdateStatus::ClearRequired(_))
                    | Ok(UpdateStatus::NativeUpdateRequired(_))
                    | Err(_)
            );

            if let Err(error) = &next {
                tracing::error!(
                    error=%error,
                    "[bundle-update] update check failed"
                );
            }

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
                let native_app_info = self
                    .system_query
                    .get_native_app_info()
                    .await
                    .context(UpdateError::Other)?;
                let app_info = AppInfo {
                    current_bundle_build: self.bundle_routes.active_identity().await.bundle_build,
                    native_build: native_app_info.native_build,
                    arch: native_app_info.arch,
                    target: native_app_info.target,
                };

                Ok(UpdateStatus::CheckingForDownload(app_info))
            }
            UpdateStatus::CheckingForDownload(app_info) => {
                let native_build = app_info.native_build;
                let res = self
                    .update_repo
                    .check_for_update(app_info)
                    .await
                    .context(UpdateError::DownloadErr)?;

                match res {
                    Some(BundleAction::Update(update)) => {
                        // Check if this bundle build was already downloaded in a previous session.
                        if let Ok(update_dir) = self.system_query.get_update_dir().await
                            && let Some(entrypoint) = find_cached_bundle(
                                &self.fs_repo,
                                &update_dir,
                                update.bundle_build,
                                native_build,
                            )
                            .await
                        {
                            return Ok(UpdateStatus::Completed(CompletedStatus {
                                bundle_build: update.bundle_build,
                                entrypoint,
                            }));
                        }
                        Ok(UpdateStatus::UpdateFound(UpdateFoundStatus {
                            bundle: update,
                        }))
                    }
                    Some(BundleAction::Clear(clear)) => {
                        Ok(UpdateStatus::ClearRequired(ClearRequiredStatus {
                            reason: clear.reason,
                        }))
                    }
                    Some(BundleAction::NativeUpdateRequired(required)) => Ok(
                        UpdateStatus::NativeUpdateRequired(NativeUpdateRequiredStatus {
                            bundle_build: required.bundle_build,
                            min_native_build: required.min_native_build,
                        }),
                    ),
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
            UpdateStatus::ClearRequired(clear) => Ok(UpdateStatus::ClearRequired(clear)),
            UpdateStatus::NativeUpdateRequired(required) => {
                Ok(UpdateStatus::NativeUpdateRequired(required))
            }
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

                let expected_bundle_build = status.update.bundle_build;
                let expected_min_native_build = status.update.min_native_build;
                let expected_checksum = status.update.checksum.clone();
                let (req, rx) = status.update.into_download_request(&download_filename);

                let status_tx = self.status_tx.clone();
                S::spawn(glue_channels(rx, status_tx, |cur, progress| match cur {
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
                    expected_bundle_build,
                    expected_min_native_build,
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
                let update_dir = archive_target.parent().map(Path::to_path_buf);
                let (req, rx) = UnzipRequest::new(unzip_status.zip_filename, archive_target);

                let status_tx = self.status_tx.clone();
                S::spawn(glue_channels(rx, status_tx, |cur, progress| match cur {
                    UpdateStatus::UnzippingBundle(zip) => {
                        zip.progress = progress;
                        true
                    }
                    _ => false,
                }));

                let bundle_dir = self.fs_repo.unzip(req).await.context(UpdateError::Unzip)?;
                validate_bundle_dir(
                    &self.fs_repo,
                    &bundle_dir,
                    unzip_status.expected_bundle_build,
                    unzip_status.expected_min_native_build,
                    self.system_query
                        .get_native_app_info()
                        .await
                        .context(UpdateError::Other)?
                        .native_build,
                )
                .await
                .context(UpdateError::Unzip)?;
                if let Some(update_dir) = update_dir {
                    let marker = update_dir.join(PENDING_BUNDLE_ROOT_FILE);
                    if let Err(e) =
                        persist_pending_bundle(&self.fs_repo, &update_dir, &bundle_dir).await
                    {
                        tracing::warn!(
                            error=?e,
                            update_dir=?update_dir,
                            marker=?marker,
                            bundle_dir=?bundle_dir,
                            "[bundle-update] failed to persist pending bundle marker"
                        );
                    }
                } else {
                    tracing::warn!(
                        bundle_dir=?bundle_dir,
                        "[bundle-update] could not derive update dir for pending bundle marker"
                    );
                }
                let mut entrypoint = bundle_dir;
                entrypoint.push(ENTRYPOINT_NAME);
                Ok(UpdateStatus::Completed(CompletedStatus {
                    bundle_build: unzip_status.expected_bundle_build,
                    entrypoint,
                }))
            }
            UpdateStatus::Completed(x) => Ok(UpdateStatus::Completed(x)),
        }
    }

    async fn should_download_now(&self) -> Result<bool, Report> {
        let network_type = self.system_query.get_network_type().await?;
        tracing::debug!(
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

/// Search existing numeric bundle directories for one whose manifest matches
/// `bundle_build` and is compatible with this native app.
async fn find_cached_bundle(
    fs: &impl FsRepo,
    update_dir: &std::path::Path,
    bundle_build: u64,
    native_build: u64,
) -> Option<PathBuf> {
    let names = fs.list_dir_names(update_dir).await;
    tracing::debug!(
        "find_cached_bundle: looking for bundle build {bundle_build} in {update_dir:?}, found dirs: {names:?}"
    );
    for name in names {
        if name.parse::<u64>().is_err() {
            continue;
        }
        let dir = update_dir.join(&name);
        let Some(manifest) = BundleManifest::read(&dir.join("bundle-manifest.json"), fs).await
        else {
            tracing::debug!("find_cached_bundle: no valid manifest in {dir:?}");
            continue;
        };
        if manifest.bundle_build == bundle_build && manifest.min_native_build <= native_build {
            let entrypoint = dir.join(ENTRYPOINT_NAME);
            if fs.read_to_string(&entrypoint).await.is_ok() {
                tracing::debug!("find_cached_bundle: hit reusing {entrypoint:?}");
                return Some(entrypoint);
            }
        }
    }
    tracing::debug!("find_cached_bundle: no cached bundle found for {bundle_build}");
    None
}

async fn validate_bundle_dir(
    fs: &impl FsRepo,
    bundle_dir: &Path,
    expected_bundle_build: u64,
    expected_min_native_build: u64,
    native_build: u64,
) -> Result<(), rootcause::Report> {
    let manifest = BundleManifest::read(&bundle_dir.join("bundle-manifest.json"), fs)
        .await
        .ok_or_else(|| report!("Missing or invalid bundle-manifest.json in {bundle_dir:?}"))?;
    if manifest.bundle_build != expected_bundle_build {
        return Err(report!(
            "Downloaded bundle build {} did not match expected {}",
            manifest.bundle_build,
            expected_bundle_build
        ));
    }
    if manifest.min_native_build != expected_min_native_build {
        return Err(report!(
            "Downloaded min native build {} did not match expected {}",
            manifest.min_native_build,
            expected_min_native_build
        ));
    }
    if manifest.min_native_build > native_build {
        return Err(report!(
            "Downloaded bundle requires native build {}, current native build is {}",
            manifest.min_native_build,
            native_build
        ));
    }
    if fs
        .read_to_string(&bundle_dir.join(ENTRYPOINT_NAME))
        .await
        .is_err()
    {
        return Err(report!("Downloaded bundle missing {ENTRYPOINT_NAME}"));
    }
    Ok(())
}

async fn persist_pending_bundle(
    fs: &impl FsRepo,
    cache_dir: &Path,
    bundle_dir: &Path,
) -> Result<(), std::io::Error> {
    fs.write(
        &cache_dir.join(PENDING_BUNDLE_ROOT_FILE),
        bundle_dir.to_string_lossy().as_bytes(),
    )
    .await
}

async fn clear_pending_bundle(fs: &impl FsRepo, cache_dir: &Path) -> Result<(), std::io::Error> {
    fs.remove_file(&cache_dir.join(PENDING_BUNDLE_ROOT_FILE))
        .await
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
    pub fn new<U: UpdateRepo, Q: SystemQuery, S: TaskSpawner>(
        update_repo: U,
        fs_repo: Fs,
        system_query: Q,
        embedded_bundle_build: u64,
        native_build: u64,
        bundle_routes: BundleRoutes,
    ) -> Self {
        let handle = Worker::<U, Fs, Q, S>::new_handle(
            update_repo,
            fs_repo.clone(),
            system_query,
            bundle_routes.clone(),
        );
        Service {
            handle,
            fs_repo,
            embedded_bundle_build,
            native_build,
            bundle_root: BundleRoot::new(),
            bundle_routes,
            pending_reload_bundle_build: None,
            reload_dispatched_at: None,
        }
    }

    /// Load persisted bundle root from the given cache directory.
    ///
    /// Returns `true` when a completed-but-not-applied bundle was restored and
    /// should be applied before starting a fresh update check.
    pub async fn load_bundle_root(&mut self, cache_dir: &Path, native_build: u64) -> bool {
        self.bundle_root = BundleRoot::load(cache_dir, &self.fs_repo).await;
        if !self.current_bundle_is_usable(native_build).await {
            tracing::warn!("Clearing unusable persisted bundle root");
            let _ = self.clear_bundle_root(cache_dir).await;
            self.cleanup_old_bundles(cache_dir, None).await;
        }
        if let Some(path) = self.bundle_root.path()
            && let Some(manifest) = self.bundle_root.manifest(&self.fs_repo).await
        {
            self.bundle_routes
                .restore(BundleSource::ota(manifest.bundle_build, path.to_path_buf()))
                .await;
            if let Err(e) = self.clear_pending_bundle(cache_dir).await {
                tracing::warn!(error=?e, "Failed to clear stale pending bundle marker");
            }
            return false;
        }
        self.bundle_routes
            .restore(BundleSource::embedded(self.embedded_bundle_build))
            .await;

        self.restore_pending_completed_update(cache_dir, native_build)
            .await
    }

    /// Bundle build embedded in this native app.
    pub fn embedded_bundle_build(&self) -> u64 {
        self.embedded_bundle_build
    }

    /// Native build of the running application.
    pub fn native_build(&self) -> u64 {
        self.native_build
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
        if self.pending_reload_bundle_build.is_some() {
            return Ok(if self.reload_dispatched_at.is_some() {
                ApplyUpdateResult::ReloadAlreadyDispatched
            } else {
                ApplyUpdateResult::ReloadNeeded
            });
        }

        let should_clear = {
            let status = self.status().borrow();
            matches!(status.as_ref(), Ok(UpdateStatus::ClearRequired(_)))
        };
        if should_clear {
            return Ok(self.revert_to_embedded(cache_dir).await?);
        }

        let completed = {
            let status = self.status().borrow();
            match status.as_ref() {
                Ok(UpdateStatus::Completed(completed)) => completed.clone(),
                _ => return Ok(ApplyUpdateResult::NoUpdate),
            }
        };

        let bundle_build = completed.bundle_build;
        let entrypoint = completed.entrypoint;
        let bundle_dir = entrypoint
            .parent()
            .ok_or_else(|| report!("entrypoint {entrypoint:?} has no parent directory"))?
            .to_path_buf();

        self.set_bundle_root(bundle_dir.clone(), bundle_build, cache_dir)
            .await?;
        self.clear_pending_bundle(cache_dir).await?;
        self.pending_reload_bundle_build = Some(bundle_build);
        self.reload_dispatched_at = None;

        Ok(ApplyUpdateResult::ReloadNeeded)
    }

    /// Record that the pending reload was successfully dispatched to the webview.
    pub fn mark_update_reload_dispatched(&mut self) {
        if self.pending_reload_bundle_build.is_some() {
            self.reload_dispatched_at = Some(Instant::now());
        }
    }

    /// Clear a pending reload dispatch marker after dispatch failed synchronously.
    pub fn unmark_update_reload_dispatched(&mut self) -> bool {
        if self.pending_reload_bundle_build.is_none() || self.reload_dispatched_at.is_none() {
            return false;
        }

        self.reload_dispatched_at = None;
        true
    }

    /// Allow a stale pending reload dispatch to be attempted again.
    pub fn allow_update_reload_retry(&mut self) -> bool {
        if self.pending_reload_bundle_build.is_none() || self.reload_dispatched_at.is_none() {
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
    pub async fn acknowledge_update_reload(
        &mut self,
        cache_dir: &Path,
        loaded_bundle_build: u64,
    ) -> Result<bool, Report> {
        let Some(expected_bundle_build) = self.pending_reload_bundle_build else {
            return Ok(false);
        };
        if loaded_bundle_build != expected_bundle_build {
            tracing::warn!(
                loaded_bundle_build,
                expected_bundle_build,
                "Ignoring bundle reload acknowledgement from a stale document"
            );
            return Ok(false);
        }

        self.bundle_routes.finish_transition().await;
        let active_root = self.bundle_root.path().map(Path::to_path_buf);
        self.cleanup_old_bundles(cache_dir, active_root.as_deref())
            .await;
        self.restart_run_after_reload_ack()?;
        self.pending_reload_bundle_build = None;
        self.reload_dispatched_at = None;
        Ok(true)
    }

    /// Set the bundle root to a new directory and persist it.
    ///
    /// The in-memory state is only updated after persistence succeeds.
    async fn set_bundle_root(
        &mut self,
        path: PathBuf,
        bundle_build: u64,
        cache_dir: &Path,
    ) -> Result<(), std::io::Error> {
        // Persist first — only commit in-memory if the write succeeds.
        let new_root = BundleRoot::from_path(path.clone());
        new_root.persist(cache_dir, &self.fs_repo).await?;
        self.bundle_root = new_root;
        self.bundle_routes
            .transition_to(BundleSource::ota(bundle_build, path))
            .await;
        Ok(())
    }

    async fn clear_pending_bundle(&self, cache_dir: &Path) -> Result<(), std::io::Error> {
        clear_pending_bundle(&self.fs_repo, cache_dir).await
    }

    async fn restore_pending_completed_update(
        &mut self,
        cache_dir: &Path,
        native_build: u64,
    ) -> bool {
        let marker = cache_dir.join(PENDING_BUNDLE_ROOT_FILE);
        let Ok(contents) = self.fs_repo.read_to_string(&marker).await else {
            return self
                .restore_latest_completed_download(cache_dir, native_build)
                .await;
        };

        let bundle_dir = PathBuf::from(contents.trim());
        self.restore_completed_bundle_dir(cache_dir, native_build, bundle_dir)
            .await
    }

    async fn restore_latest_completed_download(
        &mut self,
        cache_dir: &Path,
        native_build: u64,
    ) -> bool {
        let mut candidates = Vec::new();
        for name in self.fs_repo.list_dir_names(cache_dir).await {
            if name.parse::<u64>().is_err() {
                continue;
            }
            let bundle_dir = cache_dir.join(&name);
            let Some(manifest) =
                BundleManifest::read(&bundle_dir.join("bundle-manifest.json"), &self.fs_repo).await
            else {
                continue;
            };
            if manifest.bundle_build < self.embedded_bundle_build
                || manifest.min_native_build > native_build
                || self
                    .fs_repo
                    .read_to_string(&bundle_dir.join(ENTRYPOINT_NAME))
                    .await
                    .is_err()
            {
                continue;
            }
            candidates.push((manifest.bundle_build, bundle_dir));
        }

        let Some((_, bundle_dir)) = candidates
            .into_iter()
            .max_by_key(|(bundle_build, _)| *bundle_build)
        else {
            return false;
        };

        self.restore_completed_bundle_dir(cache_dir, native_build, bundle_dir)
            .await
    }

    async fn restore_completed_bundle_dir(
        &mut self,
        cache_dir: &Path,
        native_build: u64,
        bundle_dir: PathBuf,
    ) -> bool {
        let Some(manifest) =
            BundleManifest::read(&bundle_dir.join("bundle-manifest.json"), &self.fs_repo).await
        else {
            let _ = self.clear_pending_bundle(cache_dir).await;
            return false;
        };

        let entrypoint = bundle_dir.join(ENTRYPOINT_NAME);
        let usable = manifest.bundle_build >= self.embedded_bundle_build
            && manifest.min_native_build <= native_build
            && self.fs_repo.read_to_string(&entrypoint).await.is_ok();
        if !usable {
            let _ = self.clear_pending_bundle(cache_dir).await;
            return false;
        }

        if let Err(e) = self
            .handle
            .status_tx
            .send(Ok(UpdateStatus::Completed(CompletedStatus {
                bundle_build: manifest.bundle_build,
                entrypoint,
            })))
        {
            tracing::warn!(error=?e, "[bundle-update] failed to restore pending bundle status");
            return false;
        }

        true
    }

    /// Revert to the embedded bundle and request a webview reload.
    pub async fn revert_to_embedded(
        &mut self,
        cache_dir: &Path,
    ) -> Result<ApplyUpdateResult, std::io::Error> {
        if self.pending_reload_bundle_build.is_some() {
            return Ok(if self.reload_dispatched_at.is_some() {
                ApplyUpdateResult::ReloadAlreadyDispatched
            } else {
                ApplyUpdateResult::ReloadNeeded
            });
        }
        self.clear_bundle_root(cache_dir).await?;
        self.pending_reload_bundle_build = Some(self.embedded_bundle_build);
        self.reload_dispatched_at = None;
        Ok(ApplyUpdateResult::ReloadNeeded)
    }

    /// Clear the active bundle root while retaining OTA files needed by the
    /// currently loaded document until reload acknowledgement.
    async fn clear_bundle_root(&mut self, cache_dir: &Path) -> Result<(), std::io::Error> {
        self.clear_pending_bundle(cache_dir).await?;
        let cleared_bundle_root = BundleRoot::new();
        cleared_bundle_root
            .persist(cache_dir, &self.fs_repo)
            .await?;
        self.bundle_root = cleared_bundle_root;
        self.bundle_routes
            .transition_to(BundleSource::embedded(self.embedded_bundle_build))
            .await;
        Ok(())
    }

    /// Return the active OTA bundle build, if the embedded bundle is not active.
    pub async fn bundle_build(&self) -> Option<u64> {
        let identity = self.bundle_routes.active_identity().await;
        (identity.source == BundleSourceKind::Ota).then_some(identity.bundle_build)
    }

    /// Remove all numeric bundle subdirectories under `dir` except `keep`.
    async fn cleanup_old_bundles(&self, dir: &Path, keep: Option<&Path>) {
        for name in self.fs_repo.list_dir_names(dir).await {
            if name.parse::<u64>().is_err() {
                continue;
            }
            let path = dir.join(&name);
            if keep.is_some_and(|keep| path == keep) {
                continue;
            }
            if let Err(e) = self.fs_repo.remove_dir_all(&path).await {
                tracing::warn!(error=?e, "Failed to remove old bundle directory {path:?}");
            }
        }
    }

    async fn current_bundle_is_usable(&self, native_build: u64) -> bool {
        let Some(path) = self.bundle_root.path() else {
            return true;
        };
        if self
            .fs_repo
            .read_to_string(&path.join(ENTRYPOINT_NAME))
            .await
            .is_err()
        {
            return false;
        }
        let Some(manifest) = self.bundle_root.manifest(&self.fs_repo).await else {
            return false;
        };
        manifest.bundle_build >= self.embedded_bundle_build
            && manifest.min_native_build <= native_build
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
mod persistence_test;
#[cfg(test)]
mod reload_test;
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        models::{
            AppInfo, Arch, BundleAction, BundleClear, BundleNativeUpdateRequired, BundleUpdate,
            DownloadBundleError, DownloadBundleRequest, NativeAppInfo, Target, UnzipError,
        },
        ports::AutoUpdateService,
    };
    use std::{
        collections::{HashMap, HashSet},
        future::pending,
        io::ErrorKind,
        path::Component,
        sync::atomic::{AtomicUsize, Ordering},
        sync::{Arc, Mutex as StdMutex},
        time::Duration,
    };

    #[derive(Clone)]
    struct FakeUpdateRepo {
        update: Option<BundleAction>,
        block_download: bool,
        download_count: Arc<AtomicUsize>,
    }

    impl UpdateRepo for FakeUpdateRepo {
        async fn check_for_update(
            &self,
            _request: AppInfo,
        ) -> Result<Option<BundleAction>, rootcause::Report> {
            Ok(self.update.clone())
        }

        async fn get_update_bundle<P: AsRef<Path> + Send>(
            &self,
            _request: DownloadBundleRequest<P>,
        ) -> Result<(), Report<DownloadBundleError>> {
            self.download_count.fetch_add(1, Ordering::SeqCst);
            if self.block_download {
                pending::<()>().await;
            }
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    pub(super) struct FakeFs {
        state: Arc<StdMutex<FakeFsState>>,
    }

    #[derive(Default)]
    struct FakeFsState {
        files: HashMap<PathBuf, String>,
        dirs: HashSet<PathBuf>,
        removed_dirs: Vec<PathBuf>,
        unzip_target: Option<PathBuf>,
        checksum_should_fail: bool,
        remove_file_failure: Option<PathBuf>,
    }

    impl FakeFs {
        fn write_file(&self, path: impl Into<PathBuf>, contents: impl Into<String>) {
            let path = path.into();
            let mut state = self.state.lock().unwrap();
            insert_parent_dirs(&mut state.dirs, &path);
            state.files.insert(path, contents.into());
        }

        fn create_dir(&self, path: impl Into<PathBuf>) {
            let path = path.into();
            let mut state = self.state.lock().unwrap();
            insert_dir_and_parents(&mut state.dirs, &path);
        }

        fn set_unzip_target(&self, path: impl Into<PathBuf>) {
            self.state.lock().unwrap().unzip_target = Some(path.into());
        }

        pub(super) fn fail_remove_file(&self, path: impl Into<PathBuf>) {
            self.state.lock().unwrap().remove_file_failure = Some(path.into());
        }

        pub(super) fn file_exists(&self, path: impl AsRef<Path>) -> bool {
            self.state.lock().unwrap().files.contains_key(path.as_ref())
        }

        fn dir_exists(&self, path: impl AsRef<Path>) -> bool {
            self.state.lock().unwrap().dirs.contains(path.as_ref())
        }

        fn removed_dirs(&self) -> Vec<PathBuf> {
            self.state.lock().unwrap().removed_dirs.clone()
        }
    }

    fn insert_parent_dirs(dirs: &mut HashSet<PathBuf>, path: &Path) {
        if let Some(parent) = path.parent() {
            insert_dir_and_parents(dirs, parent);
        }
    }

    fn insert_dir_and_parents(dirs: &mut HashSet<PathBuf>, path: &Path) {
        let mut cur = PathBuf::new();
        for component in path.components() {
            match component {
                Component::RootDir => cur.push(Path::new("/")),
                other => cur.push(other.as_os_str()),
            }
            dirs.insert(cur.clone());
        }
    }

    fn not_found() -> std::io::Error {
        std::io::Error::new(ErrorKind::NotFound, "missing")
    }

    fn immediate_child_name(parent: &Path, child: &Path) -> Option<String> {
        let rel = child.strip_prefix(parent).ok()?;
        let mut components = rel.components();
        let first = components.next()?;
        if matches!(first, Component::CurDir) {
            return None;
        }
        Some(first.as_os_str().to_string_lossy().to_string())
    }

    impl FsRepo for FakeFs {
        async fn verify_checksum<P: AsRef<Path> + Send>(
            &self,
            _path: P,
            _expected: &str,
        ) -> Result<(), UnzipError> {
            if self.state.lock().unwrap().checksum_should_fail {
                return Err(UnzipError::ChecksumMismatch {
                    expected: "expected".to_string(),
                    actual: "actual".to_string(),
                });
            }
            Ok(())
        }

        async fn unzip(&self, request: UnzipRequest) -> Result<PathBuf, UnzipError> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .unzip_target
                .clone()
                .unwrap_or(request.archive_target))
        }

        async fn create_dir_all<P: AsRef<Path> + Send>(
            &self,
            path: P,
        ) -> Result<(), std::io::Error> {
            self.create_dir(path.as_ref().to_path_buf());
            Ok(())
        }

        async fn list_dir_names(&self, dir: &Path) -> Vec<String> {
            let state = self.state.lock().unwrap();
            let mut names = HashSet::new();
            for path in state.dirs.iter().chain(state.files.keys()) {
                if path == dir {
                    continue;
                }
                if let Some(name) = immediate_child_name(dir, path) {
                    names.insert(name);
                }
            }
            let mut names = names.into_iter().collect::<Vec<_>>();
            names.sort();
            names
        }

        async fn remove_dir_all(&self, dir: &Path) -> Result<(), std::io::Error> {
            let mut state = self.state.lock().unwrap();
            state.removed_dirs.push(dir.to_path_buf());
            state.dirs.retain(|path| !path.starts_with(dir));
            state.files.retain(|path, _| !path.starts_with(dir));
            Ok(())
        }

        async fn read_to_string(&self, path: &Path) -> Result<String, std::io::Error> {
            self.state
                .lock()
                .unwrap()
                .files
                .get(path)
                .cloned()
                .ok_or_else(not_found)
        }

        async fn write(&self, path: &Path, contents: &[u8]) -> Result<(), std::io::Error> {
            self.write_file(
                path.to_path_buf(),
                String::from_utf8_lossy(contents).to_string(),
            );
            Ok(())
        }

        async fn remove_file(&self, path: &Path) -> Result<(), std::io::Error> {
            let mut state = self.state.lock().unwrap();
            if state.remove_file_failure.as_deref() == Some(path) {
                return Err(std::io::Error::other("remove failed"));
            }
            state.files.remove(path);
            Ok(())
        }
    }

    #[derive(Clone, Copy)]
    struct TestTaskSpawner;

    impl TaskSpawner for TestTaskSpawner {
        fn spawn(task: impl Future<Output = ()> + Send + 'static) {
            drop(tokio::spawn(task));
        }
    }

    #[derive(Clone)]
    struct FakeSystemQuery {
        network_type: Arc<StdMutex<Option<String>>>,
        network_type_error: Arc<StdMutex<bool>>,
        native_build: Arc<StdMutex<u64>>,
        update_dir: PathBuf,
    }

    impl FakeSystemQuery {
        fn new(network_type: &str) -> Self {
            Self::with_update_dir_and_native_build(
                network_type,
                std::env::temp_dir().join("macro_bundle_updater_plugin_tests"),
                0,
            )
        }

        fn with_update_dir_and_native_build(
            network_type: &str,
            update_dir: PathBuf,
            native_build: u64,
        ) -> Self {
            Self {
                network_type: Arc::new(StdMutex::new(Some(network_type.to_string()))),
                network_type_error: Arc::new(StdMutex::new(false)),
                native_build: Arc::new(StdMutex::new(native_build)),
                update_dir,
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
        async fn get_native_app_info(&self) -> Result<NativeAppInfo, rootcause::Report> {
            Ok(NativeAppInfo {
                native_build: *self.native_build.lock().unwrap(),
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
            bundle_build: 1,
            min_native_build: 0,
            notes: None,
            url: "https://example.com/bundle.zip".parse().unwrap(),
            checksum: "checksum".to_string(),
        }
    }

    fn fake_update_repo(
        update: Option<BundleAction>,
        block_download: bool,
    ) -> (FakeUpdateRepo, Arc<AtomicUsize>) {
        let download_count = Arc::new(AtomicUsize::new(0));
        (
            FakeUpdateRepo {
                update,
                block_download,
                download_count: download_count.clone(),
            },
            download_count,
        )
    }

    pub(super) fn cache_dir() -> PathBuf {
        PathBuf::from("/cache")
    }

    fn manifest_json(bundle_build: u64, min_native_build: u64) -> String {
        format!(
            r#"{{"schemaVersion":2,"bundleBuild":{bundle_build},"minNativeBuild":{min_native_build},"gitSha":"test","appVersion":"2.5.0"}}"#
        )
    }

    pub(super) fn seed_bundle(
        fs: &FakeFs,
        cache_dir: &Path,
        dir_name: &str,
        bundle_build: u64,
        min_native_build: u64,
    ) -> PathBuf {
        let dir = cache_dir.join(dir_name);
        fs.create_dir(dir.clone());
        fs.write_file(dir.join(ENTRYPOINT_NAME), "<html></html>");
        fs.write_file(
            dir.join("bundle-manifest.json"),
            manifest_json(bundle_build, min_native_build),
        );
        dir
    }

    pub(super) fn seed_persisted_bundle_root(fs: &FakeFs, cache_dir: &Path, bundle_dir: &Path) {
        fs.write_file(
            cache_dir.join("bundle_root"),
            bundle_dir.to_string_lossy().to_string(),
        );
    }

    fn seed_pending_bundle_root(fs: &FakeFs, cache_dir: &Path, bundle_dir: &Path) {
        fs.write_file(
            cache_dir.join(PENDING_BUNDLE_ROOT_FILE),
            bundle_dir.to_string_lossy().to_string(),
        );
    }

    fn service_with_network(network_type: &str) -> (Service<FakeFs>, FakeSystemQuery) {
        let system_query = FakeSystemQuery::new(network_type);
        let (update_repo, _) = fake_update_repo(Some(BundleAction::Update(bundle_update())), true);
        let service = Service::new::<_, _, TestTaskSpawner>(
            update_repo,
            FakeFs::default(),
            system_query.clone(),
            0,
            0,
            BundleRoutes::new(0),
        );
        (service, system_query)
    }

    pub(super) fn service_with_status(status: UpdateStatus) -> (Service<FakeFs>, StartRx) {
        service_with_status_fs_and_embedded_build(status, FakeFs::default(), 0)
    }

    pub(super) fn service_with_status_and_fs(
        status: UpdateStatus,
        fs_repo: FakeFs,
    ) -> (Service<FakeFs>, StartRx) {
        service_with_status_fs_and_embedded_build(status, fs_repo, 0)
    }

    fn service_with_status_fs_and_embedded_build(
        status: UpdateStatus,
        fs_repo: FakeFs,
        embedded_bundle_build: u64,
    ) -> (Service<FakeFs>, StartRx) {
        let (status_tx, status_rx) = tokio::sync::watch::channel(Ok(status));
        let (start_tx, start_rx) = tokio::sync::mpsc::channel(1);
        (
            Service {
                handle: WorkerHandle {
                    status_rx,
                    status_tx,
                    start_tx,
                },
                fs_repo,
                embedded_bundle_build,
                native_build: 0,
                bundle_root: BundleRoot::new(),
                bundle_routes: BundleRoutes::new(embedded_bundle_build),
                pending_reload_bundle_build: None,
                reload_dispatched_at: None,
            },
            start_rx,
        )
    }

    fn worker_with_fs_and_native_build(
        fs_repo: FakeFs,
        update: Option<BundleAction>,
        update_dir: PathBuf,
        native_build: u64,
    ) -> Worker<FakeUpdateRepo, FakeFs, FakeSystemQuery, TestTaskSpawner> {
        let (status_tx, _status_rx) = tokio::sync::watch::channel(Ok(UpdateStatus::Idle));
        let (_start_tx, start_rx) = tokio::sync::mpsc::channel(1);
        let (update_repo, _) = fake_update_repo(update, false);
        Worker {
            update_repo,
            fs_repo,
            system_query: FakeSystemQuery::with_update_dir_and_native_build(
                "wifi",
                update_dir,
                native_build,
            ),
            bundle_routes: BundleRoutes::new(0),
            _task_spawner: PhantomData::<TestTaskSpawner>,
            status_tx,
            start_rx,
        }
    }

    fn app_info(native_build: u64) -> AppInfo {
        AppInfo {
            current_bundle_build: 0,
            native_build,
            arch: Arch::Aarch64,
            target: Target::Ios,
        }
    }

    fn unzip_status(
        cache_dir: &Path,
        expected_bundle_build: u64,
        expected_min_native_build: u64,
    ) -> UnzipStatus {
        UnzipStatus {
            zip_filename: cache_dir.join("0").join("bundle.zip"),
            expected_bundle_build,
            expected_min_native_build,
            expected_checksum: "checksum".to_string(),
            progress: ProgressPercentage::default(),
        }
    }

    fn completed_status() -> UpdateStatus {
        UpdateStatus::Completed(CompletedStatus {
            bundle_build: 1,
            entrypoint: PathBuf::from("/tmp/macro-bundle-test/1/index.html"),
        })
    }

    pub(super) fn clear_required_status() -> UpdateStatus {
        UpdateStatus::ClearRequired(ClearRequiredStatus {
            reason: "bundle_revoked".to_string(),
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
    async fn persisted_ota_older_than_embedded_bundle_is_cleared() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "1", 10, 0);
        seed_persisted_bundle_root(&fs, &cache_dir, &bundle_dir);
        seed_bundle(&fs, &cache_dir, "2", 11, 0);
        let (mut service, _start_rx) =
            service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 20);

        service.load_bundle_root(&cache_dir, 0).await;

        assert!(service.bundle_root_path().is_none());
        assert!(!fs.file_exists(cache_dir.join("bundle_root")));
        assert!(!fs.dir_exists(cache_dir.join("1")));
        assert!(!fs.dir_exists(cache_dir.join("2")));
    }

    #[tokio::test]
    async fn persisted_ota_with_missing_manifest_is_cleared() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = cache_dir.join("1");
        fs.create_dir(bundle_dir.clone());
        fs.write_file(bundle_dir.join(ENTRYPOINT_NAME), "<html></html>");
        seed_persisted_bundle_root(&fs, &cache_dir, &bundle_dir);
        let (mut service, _start_rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());

        service.load_bundle_root(&cache_dir, 0).await;

        assert!(service.bundle_root_path().is_none());
        assert!(!fs.file_exists(cache_dir.join("bundle_root")));
        assert!(!fs.dir_exists(cache_dir.join("1")));
    }

    #[tokio::test]
    async fn persisted_ota_with_invalid_manifest_is_cleared() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = cache_dir.join("1");
        fs.create_dir(bundle_dir.clone());
        fs.write_file(bundle_dir.join(ENTRYPOINT_NAME), "<html></html>");
        fs.write_file(bundle_dir.join("bundle-manifest.json"), "{not json");
        seed_persisted_bundle_root(&fs, &cache_dir, &bundle_dir);
        let (mut service, _start_rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());

        service.load_bundle_root(&cache_dir, 0).await;

        assert!(service.bundle_root_path().is_none());
        assert!(!fs.file_exists(cache_dir.join("bundle_root")));
        assert!(!fs.dir_exists(cache_dir.join("1")));
    }

    #[tokio::test]
    async fn persisted_ota_requiring_too_new_native_build_is_cleared() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "1", 20, 143);
        seed_persisted_bundle_root(&fs, &cache_dir, &bundle_dir);
        let (mut service, _start_rx) = service_with_status_and_fs(UpdateStatus::Idle, fs.clone());

        service.load_bundle_root(&cache_dir, 142).await;

        assert!(service.bundle_root_path().is_none());
        assert!(!fs.file_exists(cache_dir.join("bundle_root")));
        assert!(!fs.dir_exists(cache_dir.join("1")));
    }

    #[tokio::test]
    async fn persisted_compatible_ota_is_restored() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "1", 20, 143);
        seed_persisted_bundle_root(&fs, &cache_dir, &bundle_dir);
        let (mut service, _start_rx) =
            service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 10);

        service.load_bundle_root(&cache_dir, 143).await;

        assert_eq!(service.bundle_root_path(), Some(bundle_dir.as_path()));
        assert!(fs.file_exists(cache_dir.join("bundle_root")));
        assert!(fs.dir_exists(cache_dir.join("1")));
        assert!(fs.removed_dirs().is_empty());
    }

    #[tokio::test]
    async fn pending_completed_ota_is_restored_after_restart() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "1", 20, 143);
        seed_pending_bundle_root(&fs, &cache_dir, &bundle_dir);
        let (mut service, _start_rx) =
            service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 10);

        let restored_pending = service.load_bundle_root(&cache_dir, 143).await;

        assert!(restored_pending);
        let status = service.status().borrow().as_ref().unwrap().clone();
        let UpdateStatus::Completed(completed) = status else {
            panic!("expected completed status");
        };
        assert_eq!(completed.entrypoint, bundle_dir.join(ENTRYPOINT_NAME));
        assert!(fs.file_exists(cache_dir.join(PENDING_BUNDLE_ROOT_FILE)));
    }

    #[tokio::test]
    async fn pending_completed_ota_older_than_embedded_bundle_is_not_restored() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "1", 10, 0);
        seed_pending_bundle_root(&fs, &cache_dir, &bundle_dir);
        let (mut service, _start_rx) =
            service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 20);

        let restored_pending = service.load_bundle_root(&cache_dir, 0).await;

        assert!(!restored_pending);
        assert!(matches!(
            service.status().borrow().as_ref().unwrap(),
            UpdateStatus::Idle
        ));
        assert!(!fs.file_exists(cache_dir.join(PENDING_BUNDLE_ROOT_FILE)));
    }

    #[tokio::test]
    async fn unmarked_completed_ota_is_restored_from_numeric_cache_dir() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        seed_bundle(&fs, &cache_dir, "1", 20, 0);
        let bundle_dir = seed_bundle(&fs, &cache_dir, "2", 30, 0);
        let (mut service, _start_rx) =
            service_with_status_fs_and_embedded_build(UpdateStatus::Idle, fs.clone(), 10);

        let restored_pending = service.load_bundle_root(&cache_dir, 0).await;

        assert!(restored_pending);
        let status = service.status().borrow().as_ref().unwrap().clone();
        let UpdateStatus::Completed(completed) = status else {
            panic!("expected completed status");
        };
        assert_eq!(completed.entrypoint, bundle_dir.join(ENTRYPOINT_NAME));
    }

    #[tokio::test]
    async fn apply_update_clears_pending_completed_ota_marker() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "1", 20, 0);
        seed_pending_bundle_root(&fs, &cache_dir, &bundle_dir);
        let (mut service, _start_rx) = service_with_status_and_fs(
            UpdateStatus::Completed(CompletedStatus {
                bundle_build: 20,
                entrypoint: bundle_dir.join(ENTRYPOINT_NAME),
            }),
            fs.clone(),
        );

        let result = service.apply_update(&cache_dir).await.unwrap();

        assert_eq!(result, ApplyUpdateResult::ReloadNeeded);
        assert_eq!(service.bundle_root_path(), Some(bundle_dir.as_path()));
        assert!(!fs.file_exists(cache_dir.join(PENDING_BUNDLE_ROOT_FILE)));
        assert!(fs.file_exists(cache_dir.join("bundle_root")));
    }

    #[tokio::test]
    async fn service_reports_configured_embedded_bundle_build() {
        let (service, _start_rx) = service_with_status_fs_and_embedded_build(
            UpdateStatus::Idle,
            FakeFs::default(),
            1780346991624,
        );

        assert_eq!(service.embedded_bundle_build(), 1780346991624);
    }

    #[tokio::test]
    async fn cached_download_reuse_matches_by_bundle_build() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        seed_bundle(&fs, &cache_dir, "1", 29, 0);
        let bundle_dir = seed_bundle(&fs, &cache_dir, "2", 30, 0);
        let mut update = bundle_update();
        update.bundle_build = 30;
        let mut worker = worker_with_fs_and_native_build(
            fs,
            Some(BundleAction::Update(update)),
            cache_dir.clone(),
            0,
        );

        let status = worker
            .next_status(UpdateStatus::CheckingForDownload(app_info(0)))
            .await
            .unwrap();

        assert!(matches!(
            status,
            UpdateStatus::Completed(CompletedStatus { entrypoint, .. })
                if entrypoint == bundle_dir.join(ENTRYPOINT_NAME)
        ));
    }

    #[tokio::test]
    async fn cached_download_with_mismatched_bundle_build_is_not_reused() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        seed_bundle(&fs, &cache_dir, "1", 29, 0);
        let mut update = bundle_update();
        update.bundle_build = 30;
        let mut worker =
            worker_with_fs_and_native_build(fs, Some(BundleAction::Update(update)), cache_dir, 0);

        let status = worker
            .next_status(UpdateStatus::CheckingForDownload(app_info(0)))
            .await
            .unwrap();

        assert!(matches!(status, UpdateStatus::UpdateFound(_)));
    }

    #[tokio::test]
    async fn clear_action_from_server_becomes_clear_required_status() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let mut worker = worker_with_fs_and_native_build(
            fs,
            Some(BundleAction::Clear(BundleClear {
                reason: "bundle_revoked".to_string(),
            })),
            cache_dir,
            0,
        );

        let status = worker
            .next_status(UpdateStatus::CheckingForDownload(app_info(0)))
            .await
            .unwrap();

        assert!(matches!(
            status,
            UpdateStatus::ClearRequired(ClearRequiredStatus { reason })
                if reason == "bundle_revoked"
        ));
    }

    #[tokio::test]
    async fn native_update_required_action_from_server_becomes_terminal_status() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let mut worker = worker_with_fs_and_native_build(
            fs,
            Some(BundleAction::NativeUpdateRequired(
                BundleNativeUpdateRequired {
                    bundle_build: 102,
                    min_native_build: 999,
                },
            )),
            cache_dir,
            142,
        );

        let status = worker
            .next_status(UpdateStatus::CheckingForDownload(app_info(142)))
            .await
            .unwrap();

        assert!(matches!(
            status,
            UpdateStatus::NativeUpdateRequired(NativeUpdateRequiredStatus {
                bundle_build: 102,
                min_native_build: 999,
            })
        ));
    }

    #[tokio::test]
    async fn downloaded_zip_with_valid_manifest_persists_pending_marker() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "0", 40, 0);
        fs.set_unzip_target(bundle_dir.clone());
        let mut worker = worker_with_fs_and_native_build(fs.clone(), None, cache_dir.clone(), 0);

        let status = worker
            .next_status(UpdateStatus::UnzippingBundle(unzip_status(
                &cache_dir, 40, 0,
            )))
            .await
            .unwrap();

        assert!(matches!(status, UpdateStatus::Completed(_)));
        assert_eq!(
            fs.read_to_string(&cache_dir.join(PENDING_BUNDLE_ROOT_FILE))
                .await
                .unwrap(),
            bundle_dir.to_string_lossy()
        );
    }

    #[tokio::test]
    async fn downloaded_zip_with_missing_manifest_is_rejected() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = cache_dir.join("0");
        fs.create_dir(bundle_dir.clone());
        fs.write_file(bundle_dir.join(ENTRYPOINT_NAME), "<html></html>");
        fs.set_unzip_target(bundle_dir);
        let mut worker = worker_with_fs_and_native_build(fs, None, cache_dir.clone(), 0);

        let result = worker
            .next_status(UpdateStatus::UnzippingBundle(unzip_status(
                &cache_dir, 40, 0,
            )))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn downloaded_zip_with_mismatched_bundle_build_is_rejected() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "0", 41, 0);
        fs.set_unzip_target(bundle_dir);
        let mut worker = worker_with_fs_and_native_build(fs, None, cache_dir.clone(), 0);

        let result = worker
            .next_status(UpdateStatus::UnzippingBundle(unzip_status(
                &cache_dir, 40, 0,
            )))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn downloaded_zip_with_mismatched_min_native_build_is_rejected() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "0", 40, 11);
        fs.set_unzip_target(bundle_dir);
        let mut worker = worker_with_fs_and_native_build(fs, None, cache_dir.clone(), 20);

        let result = worker
            .next_status(UpdateStatus::UnzippingBundle(unzip_status(
                &cache_dir, 40, 10,
            )))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn downloaded_zip_requiring_too_new_native_build_is_rejected() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let bundle_dir = seed_bundle(&fs, &cache_dir, "0", 40, 143);
        fs.set_unzip_target(bundle_dir);
        let mut worker = worker_with_fs_and_native_build(fs, None, cache_dir.clone(), 142);

        let result = worker
            .next_status(UpdateStatus::UnzippingBundle(unzip_status(
                &cache_dir, 40, 143,
            )))
            .await;

        assert!(result.is_err());
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
            fs_repo: FakeFs::default(),
            embedded_bundle_build: 0,
            native_build: 0,
            bundle_root: BundleRoot::new(),
            bundle_routes: BundleRoutes::new(0),
            pending_reload_bundle_build: None,
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
    async fn apply_update_clears_bundle_root_when_server_revokes_active_bundle() {
        let fs = FakeFs::default();
        let cache_dir = cache_dir();
        let active_dir = seed_bundle(&fs, &cache_dir, "1", 20, 0);
        seed_bundle(&fs, &cache_dir, "2", 21, 0);
        fs.create_dir(cache_dir.join("logs"));
        fs.write_file(cache_dir.join("logs").join("trace.txt"), "keep");
        seed_persisted_bundle_root(&fs, &cache_dir, &active_dir);
        let (mut service, _start_rx) =
            service_with_status_and_fs(clear_required_status(), fs.clone());
        service.bundle_root = BundleRoot::from_path(active_dir.clone());
        service
            .bundle_routes
            .restore(BundleSource::ota(20, active_dir))
            .await;

        let applied = service.apply_update(&cache_dir).await.unwrap();

        assert_eq!(applied, ApplyUpdateResult::ReloadNeeded);
        assert_eq!(service.pending_reload_bundle_build, Some(0));
        assert!(service.bundle_root_path().is_none());
        assert!(!fs.file_exists(cache_dir.join("bundle_root")));
        assert!(fs.dir_exists(cache_dir.join("1")));
        assert!(fs.dir_exists(cache_dir.join("2")));

        assert!(
            service
                .acknowledge_update_reload(&cache_dir, 0)
                .await
                .unwrap()
        );
        assert!(!fs.dir_exists(cache_dir.join("1")));
        assert!(!fs.dir_exists(cache_dir.join("2")));
        assert!(fs.dir_exists(cache_dir.join("logs")));
        assert!(fs.file_exists(cache_dir.join("logs").join("trace.txt")));
        let removed_dirs = fs.removed_dirs();
        assert!(removed_dirs.contains(&cache_dir.join("1")));
        assert!(removed_dirs.contains(&cache_dir.join("2")));
        assert!(!removed_dirs.contains(&cache_dir.join("logs")));
    }

    #[tokio::test]
    async fn apply_update_keeps_worker_completed_until_reload_ack() {
        let (mut service, mut start_rx) = service_with_status(completed_status());

        let applied = service.apply_update(Path::new("/tmp")).await.unwrap();

        assert_eq!(applied, ApplyUpdateResult::ReloadNeeded);
        assert_eq!(service.pending_reload_bundle_build, Some(1));
        assert!(service.reload_dispatched_at.is_none());
        assert!(matches!(
            &*service.status().borrow(),
            Ok(UpdateStatus::Completed(_))
        ));
        assert!(start_rx.try_recv().is_err());

        assert!(
            service
                .acknowledge_update_reload(Path::new("/tmp"), 1)
                .await
                .unwrap()
        );
        assert_eq!(service.pending_reload_bundle_build, None);
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
        service.pending_reload_bundle_build = Some(1);

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

    #[tokio::test]
    async fn acknowledge_update_reload_returns_false_without_pending_reload() {
        let (mut service, _start_rx) = service_with_status(UpdateStatus::Idle);

        assert!(
            !service
                .acknowledge_update_reload(Path::new("/tmp"), 0)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn acknowledge_update_reload_treats_full_command_queue_as_acknowledged() {
        let (mut service, _start_rx) = service_with_status(UpdateStatus::Idle);
        service.pending_reload_bundle_build = Some(0);
        service
            .handle
            .start_tx
            .try_send(WorkerCommand::Continue)
            .unwrap();

        assert!(
            service
                .acknowledge_update_reload(Path::new("/tmp"), 0)
                .await
                .unwrap()
        );
        assert_eq!(service.pending_reload_bundle_build, None);
        assert!(service.reload_dispatched_at.is_none());
        assert!(matches!(
            &*service.status().borrow(),
            Ok(UpdateStatus::Idle)
        ));
    }
}
