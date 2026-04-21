use crate::domain::{
    models::{
        BundleRoot, CompletedStatus, ProgressPercentage, UnzipRequest, UnzipStatus,
        UpdateApproval, UpdateDownloadingStatus, UpdateError, UpdateFoundStatus, UpdateStatus,
    },
    ports::{AutoUpdateService, FsRepo, SystemQuery, UpdateRepo},
};
use rootcause::{Report, prelude::ResultExt, report};
use std::path::{Path, PathBuf};

pub struct Service {
    handle: WorkerHandle,
    bundle_root: BundleRoot,
}

/// Sender half the worker uses to offer a oneshot back to the main thread.
type GrantOfferTx = tokio::sync::mpsc::Sender<tokio::sync::oneshot::Sender<UpdateApproval>>;
/// Receiver half the main thread uses to obtain the oneshot sender.
type GrantOfferRx = tokio::sync::mpsc::Receiver<tokio::sync::oneshot::Sender<UpdateApproval>>;

/// Main thread sends on this to start the checker loop.
type StartTx = tokio::sync::mpsc::Sender<()>;
/// Worker receives on this to know when to run the checker loop.
type StartRx = tokio::sync::mpsc::Receiver<()>;

struct Worker<U, Fs, Q> {
    update_repo: U,
    fs_repo: Fs,
    system_query: Q,
    status_tx: tokio::sync::watch::Sender<Result<UpdateStatus, Report<UpdateError>>>,
    grant_offer_tx: GrantOfferTx,
    start_rx: StartRx,
}

struct WorkerHandle {
    status_rx: tokio::sync::watch::Receiver<Result<UpdateStatus, Report<UpdateError>>>,
    grant_offer_rx: GrantOfferRx,
    start_tx: StartTx,
}

/// the name of the app entrypoint
const ENTRYPOINT_NAME: &str = "index.html";

impl<U: UpdateRepo, Fs: FsRepo, Q: SystemQuery> Worker<U, Fs, Q> {
    fn new_handle(update_repo: U, fs_repo: Fs, system_query: Q) -> WorkerHandle {
        let (status_tx, status_rx) = tokio::sync::watch::channel(Ok(UpdateStatus::Idle));
        let (grant_offer_tx, grant_offer_rx) = tokio::sync::mpsc::channel(1);
        let (start_tx, start_rx) = tokio::sync::mpsc::channel(1);

        Worker {
            update_repo,
            fs_repo,
            system_query,
            status_tx,
            grant_offer_tx,
            start_rx,
        }
        .run_background();

        WorkerHandle {
            status_rx,
            grant_offer_rx,
            start_tx,
        }
    }

    fn run_background(mut self) {
        tauri::async_runtime::spawn(async move {
            // Run the checker loop once on startup, then again each time we
            // receive a restart signal from the main thread.
            while let Some(()) = self.start_rx.recv().await {
                // Reset status to Idle for the new run
                if self.status_tx.send(Ok(UpdateStatus::Idle)).is_err() {
                    break;
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

            let Ok(()) = self.status_tx.send(next) else {
                break;
            };
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
                        if let Ok(update_dir) = self.system_query.get_update_dir().await {
                            if let Some(entrypoint) =
                                find_cached_bundle(&self.fs_repo, &update_dir, &update.version)
                            {
                                return Ok(UpdateStatus::Completed(CompletedStatus {
                                    entrypoint,
                                }));
                            }
                        }
                        Ok(UpdateStatus::UpdateFound(UpdateFoundStatus {
                            bundle: update,
                        }))
                    }
                    None => Ok(UpdateStatus::NoUpdateNeeded),
                }
            }
            UpdateStatus::UpdateFound(update_found_status) => {
                let (tx, rx) = tokio::sync::oneshot::channel();
                // Send the oneshot sender to the main thread so it can respond
                self.grant_offer_tx.send(tx).await.map_err(|_| {
                    report!("Grant offer receiver was dropped").context(UpdateError::GrantErr)
                })?;
                // Wait for the main thread to send approval back
                let res = rx.await.map_err(|e| {
                    rootcause::report!("Failed to receive grant {e:?}. The sender was dropped")
                        .context(UpdateError::GrantErr)
                })?;
                match res {
                    UpdateApproval::Granted(grant) => {
                        Ok(UpdateStatus::DownloadingBundle(UpdateDownloadingStatus {
                            grant,
                            update: update_found_status.bundle,
                            progress: ProgressPercentage::default(),
                        }))
                    }
                    UpdateApproval::Denied(_update_denied) => Ok(UpdateStatus::NoUpdateNeeded),
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

    /// Create a monotonically increasing download directory and return the
    /// path where the zip should be placed.
    async fn create_download_directory(
        &self,
        mut bundle: PathBuf,
    ) -> Result<PathBuf, std::io::Error> {
        let next = next_bundle_index(&self.fs_repo.list_dir_names(&bundle));
        bundle.push(next.to_string());
        self.fs_repo.create_dir_all(&bundle).await?;
        bundle.push("bundle.zip");
        Ok(bundle)
    }
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
fn find_cached_bundle(
    fs: &impl FsRepo,
    update_dir: &std::path::Path,
    version: &semver::Version,
) -> Option<PathBuf> {
    let version_str = version.to_string();
    for name in fs.list_dir_names(update_dir) {
        if name.parse::<u64>().is_err() {
            continue;
        }
        let dir = update_dir.join(&name);
        let semver_path = dir.join("semver.txt");
        if let Ok(contents) = fs.read_to_string(&semver_path) {
            if contents.trim() == version_str {
                let entrypoint = dir.join(ENTRYPOINT_NAME);
                if fs.read_to_string(&entrypoint).is_ok() {
                    return Some(entrypoint);
                }
            }
        }
    }
    None
}

/// Remove all numeric bundle subdirectories under `dir` except `keep`.
pub fn cleanup_old_bundles(fs: &impl FsRepo, dir: &std::path::Path, keep: &std::path::Path) {
    for name in fs.list_dir_names(dir) {
        if name.parse::<u64>().is_err() {
            continue;
        }
        let path = dir.join(&name);
        if path == keep {
            continue;
        }
        if let Err(e) = fs.remove_dir_all(&path) {
            tracing::warn!(error=?e, "Failed to remove old bundle directory {path:?}");
        }
    }
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

impl Service {
    pub fn new<U: UpdateRepo, Fs: FsRepo, Q: SystemQuery>(
        update_repo: U,
        fs_repo: Fs,
        system_query: Q,
    ) -> Self {
        let handle = Worker::new_handle(update_repo, fs_repo, system_query);
        Service {
            handle,
            bundle_root: BundleRoot::new(),
        }
    }

    /// Load persisted bundle root from the given cache directory.
    pub fn load_bundle_root(&mut self, cache_dir: &Path, fs: &impl FsRepo) {
        self.bundle_root = BundleRoot::load(cache_dir, fs);
    }

    /// Get the current bundle root path, if an OTA update has been applied.
    pub fn bundle_root_path(&self) -> Option<&Path> {
        self.bundle_root.path()
    }

    /// Set the bundle root to a new directory and persist it.
    pub fn set_bundle_root(
        &mut self,
        path: PathBuf,
        cache_dir: &Path,
        fs: &impl FsRepo,
    ) -> Result<(), std::io::Error> {
        self.bundle_root.set(path);
        self.bundle_root.persist(cache_dir, fs)
    }

    /// Read the bundle version from `semver.txt` inside the current bundle root.
    pub fn bundle_version(&self, fs: &impl FsRepo) -> Option<semver::Version> {
        self.bundle_root.version(fs)
    }
}

impl AutoUpdateService for Service {
    fn status(&self) -> &tokio::sync::watch::Receiver<Result<UpdateStatus, Report<UpdateError>>> {
        &self.handle.status_rx
    }

    fn try_recv_grant_sender(
        &mut self,
    ) -> Result<tokio::sync::oneshot::Sender<UpdateApproval>, Report> {
        self.handle
            .grant_offer_rx
            .try_recv()
            .map_err(|e| report!("No pending grant offer: {e}"))
    }

    #[tracing::instrument(err, skip(self))]
    fn start(&self) -> Result<(), Report> {
        self.handle
            .start_tx
            .try_send(())
            .map_err(|e| report!("Failed to send start signal: {e}"))
    }
}
