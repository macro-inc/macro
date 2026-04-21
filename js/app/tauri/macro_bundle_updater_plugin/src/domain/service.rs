use crate::domain::{
    models::{
        CompletedStatus, ProgressPercentage, UnzipRequest, UnzipStatus, UpdateApproval,
        UpdateDownloadingStatus, UpdateError, UpdateFoundStatus, UpdateStatus,
    },
    ports::{AutoUpdateService, FsRepo, SystemQuery, UpdateRepo},
};
use rootcause::{Report, prelude::ResultExt, report};
use semver::Version;
use std::path::PathBuf;

pub struct Service {
    handle: WorkerHandle,
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
                    Some(update) => Ok(UpdateStatus::UpdateFound(UpdateFoundStatus {
                        bundle: update,
                    })),
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
                    .create_download_directory(update_dir, &status.update.version)
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

    /// given an input directory and a semver, create a folder for the semver and return the path
    /// that the download should be placed at
    async fn create_download_directory(
        &self,
        mut bundle: PathBuf,
        version: &Version,
    ) -> Result<PathBuf, std::io::Error> {
        let version_str = version.to_string().to_lowercase();
        bundle.push(PathBuf::from(version_str));
        self.fs_repo.create_dir_all(&bundle).await?;
        bundle.push("bundle.zip");
        Ok(bundle)
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
        Service { handle }
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
