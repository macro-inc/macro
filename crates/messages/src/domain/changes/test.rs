use super::*;
use std::sync::{Arc, Mutex};

struct Pruner {
    calls: Arc<Mutex<Vec<(DateTime<Utc>, usize)>>>,
    counts: Mutex<std::collections::VecDeque<usize>>,
}

impl ChannelChangeLogPruner for Pruner {
    async fn prune_channel_change_log(
        &self,
        cutoff: DateTime<Utc>,
        batch: usize,
    ) -> Result<usize, MessageError> {
        self.calls.lock().unwrap().push((cutoff, batch));
        Ok(self.counts.lock().unwrap().pop_front().unwrap())
    }
}

#[tokio::test]
async fn channel_retention_drains_batches_with_one_fixed_thirty_day_cutoff() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let retention = ChannelChangeLogRetention::new(Pruner {
        calls: calls.clone(),
        counts: Mutex::new([CHANGE_LOG_PRUNE_BATCH, CHANGE_LOG_PRUNE_BATCH, 7].into()),
    });
    let now = DateTime::from_timestamp(2_000_000_000, 0).unwrap();
    assert_eq!(retention.run_once(now).await.unwrap(), 20_007);
    assert_eq!(
        *calls.lock().unwrap(),
        vec![(now - chrono::Duration::days(30), CHANGE_LOG_PRUNE_BATCH); 3]
    );
}
