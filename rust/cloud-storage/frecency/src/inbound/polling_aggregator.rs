//! The polling aggregator defines a worker process for updating frecency aggregation records in the background

use std::time::Duration;

use crate::domain::{models::EventAggregationStats, ports::PullEventAggregatorService};

/// Stats about the current state of the background worker
#[derive(Debug, Clone, Copy, Default)]
#[non_exhaustive]
pub struct WorkerStats {
    /// the count of times that the worker has polled since its construction
    pub poll_count: usize,
    /// the number of input events that have been ingested since the worker was constructed
    pub aggregation_stats: EventAggregationStats,
}

impl WorkerStats {
    fn increment(&mut self, stats: EventAggregationStats) {
        self.poll_count += 1;
        self.aggregation_stats += stats;
    }
}

/// a foreground handle to a background worker task.
/// This allows stopping the background task and also subscribing to stats about how many events were processed
/// Dropping this struct will abort the worker task
pub struct FrecencyAggregatorWorkerHandle {
    stats: tokio::sync::watch::Receiver<WorkerStats>,
    handle: tokio::task::JoinHandle<()>,
}

impl FrecencyAggregatorWorkerHandle {
    /// returns a reference to the receiver end of the watch channel
    /// this allows a caller to subscribe to or read the current stats
    pub fn stats(&self) -> &tokio::sync::watch::Receiver<WorkerStats> {
        &self.stats
    }
}

impl Drop for FrecencyAggregatorWorkerHandle {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

struct FrecencyAggregatorWorker<S> {
    service: S,
    sender: tokio::sync::watch::Sender<WorkerStats>,
    poll_duration: Duration,
}

impl<S> FrecencyAggregatorWorker<S>
where
    S: PullEventAggregatorService,
{
    async fn run(self) {
        let FrecencyAggregatorWorker {
            service,
            sender,
            poll_duration,
        } = self;
        loop {
            tokio::time::sleep(poll_duration).await;
            let Ok(stats) = service.append_events_to_aggregate().await else {
                continue;
            };
            sender.send_modify(move |cur| {
                cur.increment(stats);
            });
        }
    }
}

impl FrecencyAggregatorWorkerHandle {
    /// create a new background worker and return a reference to it as a [FrecencyAggregatorWorkerHandle]
    pub fn new_worker<S>(service: S, poll_duration: Duration) -> Self
    where
        S: PullEventAggregatorService,
    {
        let (tx, rx) = tokio::sync::watch::channel(WorkerStats::default());
        let handle = tokio::task::spawn(
            FrecencyAggregatorWorker {
                service,
                sender: tx,
                poll_duration,
            }
            .run(),
        );
        FrecencyAggregatorWorkerHandle { stats: rx, handle }
    }
}
