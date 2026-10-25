//! Recording what a planning run has found in Notion so far, so the user
//! sees the scan grow while the inventory walks the workspace.

use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::watch;
use tokio::time::Instant;

use super::NOTIFY_EVERY;
use crate::domain::models::{ImportSource, ScanCounts};
use crate::domain::ports::NotionPlanRepo;

#[cfg(test)]
mod test;

/// Write the newest counts from `counts` to the run, at most every
/// [`NOTIFY_EVERY`], and the last ones as soon as the sender is dropped.
/// Returns once the sender is gone and everything sent is written.
pub(super) async fn record_scan<R: NotionPlanRepo>(
    repo: &R,
    user: &MacroUserIdStr<'static>,
    mut counts: watch::Receiver<ScanCounts>,
) {
    let mut unwritten = false;
    let mut next_write = Instant::now();
    loop {
        tokio::select! {
            changed = counts.changed() => match changed {
                Ok(()) => unwritten = true,
                Err(_) => break,
            },
            () = tokio::time::sleep_until(next_write), if unwritten => {
                let latest = *counts.borrow();
                write(repo, user, latest).await;
                unwritten = false;
                next_write = Instant::now() + NOTIFY_EVERY;
            }
        }
    }
    if unwritten {
        let latest = *counts.borrow();
        write(repo, user, latest).await;
    }
}

async fn write<R: NotionPlanRepo>(repo: &R, user: &MacroUserIdStr<'static>, scanned: ScanCounts) {
    if let Err(error) = repo.record_scan(user, ImportSource::Notion, scanned).await {
        tracing::warn!(error = ?error, "could not record the notion scan progress");
    }
}
