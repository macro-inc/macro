//! Bound the combined HTTP and tracked-work drain below the ECS stop timeout.
use std::{future::Future, time::Duration};
use tokio_util::task::TaskTracker;

const DRAIN_BUDGET: Duration = Duration::from_secs(30);

pub(crate) async fn drain(
    server: impl Future<Output = std::io::Result<()>>,
    tasks: &TaskTracker,
) -> Result<(), rootcause::Report> {
    // HTTP handlers can still be awaiting a tracked Submit. Apply one deadline
    // to both stages, rather than starting the clock after HTTP has drained.
    tokio::time::timeout(DRAIN_BUDGET, async {
        let result = server.await;
        tasks.wait().await;
        result
    })
    .await
    .inspect_err(|_| {
        tracing::warn!(
            remaining_tasks = tasks.len(),
            "IMAP shutdown drain deadline expired"
        );
    })??;
    Ok(())
}

#[cfg(test)]
mod test;
