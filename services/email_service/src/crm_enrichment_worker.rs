//! Resolves CRM company directory entries left pending by binaries without a
//! metadata resolver (manual, API, and agent company creation) or by a failed
//! resolve.

use crate::pubsub::context::CrmServiceType;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// One enrichment pass per interval keeps the resolver (Apollo) call rate at
/// the service's batch size per minute per worker.
const ENRICHMENT_INTERVAL: Duration = Duration::from_secs(60);

pub async fn run(service: CrmServiceType, cancellation: CancellationToken) {
    let mut interval = tokio::time::interval(ENRICHMENT_INTERVAL);
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = interval.tick() => {},
        }
        // The service span records the error; the next tick retries.
        let _ = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            result = service.enrich_pending_domains() => result,
        };
    }
}
