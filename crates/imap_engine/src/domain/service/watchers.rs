//! One explicitly requested extra-folder watcher. Account socket bounds, including
//! command reads and actor maintenance, are documented in the architecture guide.
use super::*;
use std::time::Duration;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument;

pub(super) struct Watcher {
    folder_id: String,
    path: String,
    pub(super) stop: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}
impl Engine {
    pub(super) async fn refresh_watcher(
        &self,
        binding: Binding,
        owner: Uuid,
        wake: &Arc<tokio::sync::Notify>,
        tasks: &TaskTracker,
        stopped: &CancellationToken,
        current: &mut Option<Watcher>,
    ) -> Result<(), Error> {
        let requested = if let Some(settings) = &self.settings {
            settings
                .preferences(binding)
                .await?
                .watched_folder_ids
                .into_iter()
                .next()
        } else {
            None
        };
        let target = if let Some(id) = requested {
            let account = self
                .repository
                .read_scoped(binding, StateSelection::Catalog)
                .await?;
            account
                .state
                .folders
                .get(&id)
                .filter(|folder| folder.folder.role != FolderRole::Inbox)
                .map(|folder| (id, folder.path.clone()))
        } else {
            None
        };
        if current.as_ref().is_some_and(|watcher| {
            target
                .as_ref()
                .is_some_and(|(id, path)| *id == watcher.folder_id && *path == watcher.path)
                && !watcher.task.is_finished()
        }) {
            return Ok(());
        }
        if let Some(previous) = current.take() {
            previous.stop.cancel();
            let _ = tokio::time::timeout(Duration::from_secs(10), previous.task).await;
        }
        let Some((folder_id, path)) = target else {
            return Ok(());
        };
        let cancel = stopped.child_token();
        let done = cancel.clone();
        let wire_path = path.clone();
        let transport = self.transport.clone();
        let repository = self.repository.clone();
        let cipher = self.cipher.clone();
        let changed = wake.clone();
        let watched_id = folder_id.clone();
        let task = tasks.spawn(async move {
            let mut failures = 0u32;
            loop {
                if done.is_cancelled() { return; }
                match repository.claim_owner(binding, owner).await { Ok(true) => {}, _ => return }
                let result = async {
                    let (user, ciphertext) = repository.credentials(binding).await?;
                    let credentials = cipher.decrypt(binding.link_id, &user, &ciphertext).await?;
                    let committed = repository.read_scoped(binding, StateSelection::Catalog)
                        .await?.state.folders.remove(&watched_id).ok_or(Error::NotFound)?;
                    if committed.path != wire_path { return Err(Error::Conflict); }
                    // Credentials live only for this socket attempt, never its retry delay.
                    tokio::select! {
                        biased;
                        _ = done.cancelled() => Ok(WaitOutcome::Restarted),
                        result = transport.wait_folder(&credentials, &committed, 120) => result,
                    }
                }.instrument(tracing::info_span!(parent: None, "imap.watch_folder", link_id = %binding.link_id, folder_id = %watched_id)).await;
                match result {
                    Ok(WaitOutcome::Restarted) => {
                        failures = 0;
                    }
                    Ok(WaitOutcome::BaselineUnavailable) => {
                        failures = failures.saturating_add(1);
                        if failures == 1 { changed.notify_one(); }
                        let seconds = (30 * 2u64.pow(failures.saturating_sub(1).min(6))).min(1800);
                        tokio::select! {
                            biased;
                            _ = done.cancelled() => return,
                            _ = tokio::time::sleep(Duration::from_secs(seconds)) => {},
                        }
                    }
                    Ok(WaitOutcome::Changed) => {
                        failures = 0;
                        tokio::select! {
                            biased;
                            _ = done.cancelled() => return,
                            _ = tokio::time::sleep(Duration::from_millis(450)) => {},
                        }
                        changed.notify_one();
                    }
                    Err(Error::CredentialsRejected | Error::Forbidden | Error::NotFound | Error::Conflict) => return,
                    Err(_) => {
                        failures = failures.saturating_add(1);
                        let retry = 2u64.pow(failures.min(8)).min(300);
                        tokio::select! {
                            biased;
                            _ = done.cancelled() => return,
                            _ = tokio::time::sleep(Duration::from_secs(retry)) => {},
                        }
                    }
                }
            }
        });
        *current = Some(Watcher {
            folder_id,
            path,
            stop: cancel,
            task,
        });
        Ok(())
    }
}
