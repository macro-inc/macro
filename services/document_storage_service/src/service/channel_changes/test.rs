use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use messages::domain::ports::MessageError;

use super::*;

#[derive(Clone, Default)]
struct CountingPruner(Arc<AtomicUsize>);

impl ChannelChangeLogPruner for CountingPruner {
    async fn prune_change_log(
        &self,
        _cutoff: chrono::DateTime<chrono::Utc>,
        _batch: usize,
    ) -> Result<usize, MessageError> {
        // Every other pass fails; the loop keeps its schedule regardless.
        if self.0.fetch_add(1, Ordering::SeqCst) % 2 == 1 {
            return Err(MessageError::NotFound);
        }
        Ok(0)
    }
}

#[tokio::test(start_paused = true)]
async fn retention_runs_at_start_then_hourly_until_cancelled() {
    let pruner = CountingPruner::default();
    let cancellation_token = CancellationToken::new();
    let task = tokio::spawn(run_retention(
        ChannelChangeLogRetention::new(pruner.clone()),
        cancellation_token.clone(),
    ));
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(pruner.0.load(Ordering::SeqCst), 1);
    tokio::time::sleep(RETENTION_INTERVAL * 2).await;
    assert_eq!(pruner.0.load(Ordering::SeqCst), 3);
    cancellation_token.cancel();
    task.await.unwrap();
}
