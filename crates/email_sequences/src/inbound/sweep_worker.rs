//! The loop that runs the sweep in every worker process.

use std::{sync::Arc, time::Duration};

use email::domain::sequence_steps::SequenceStepStore;
use tokio_util::sync::CancellationToken;

use crate::domain::{
    ports::{OwnerAccess, SequenceRepo},
    service::Sequences,
};

/// Time between sweeps.
const INTERVAL: Duration = Duration::from_secs(30);

/// Sweep until cancelled. Every worker process runs one; they share the work
/// through row locks, so more processes only add capacity.
pub async fn run<R, S, A>(sequences: Arc<Sequences<R, S, A>>, cancellation_token: CancellationToken)
where
    R: SequenceRepo,
    S: SequenceStepStore<Conn = R::Conn>,
    A: OwnerAccess,
{
    loop {
        sequences.sweep(chrono::Utc::now()).await;
        // Spread processes that started together across the interval.
        let jitter = Duration::from_millis(u64::from(rand::random::<u16>()) % 5_000);
        tokio::select! {
            () = tokio::time::sleep(INTERVAL + jitter) => {}
            () = cancellation_token.cancelled() => return,
        }
    }
}
