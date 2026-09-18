//! Drives durable scheduling intents after provider failures or process restarts.
use crate::api::context::SchedulingService;
use std::{sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

pub async fn run(service: Arc<SchedulingService>, stop: CancellationToken) {
    loop {
        for _ in 0..25 {
            tokio::select! {
                _ = stop.cancelled() => return,
                result = tokio::time::timeout(Duration::from_secs(120), service.recover_once()) => {
                    match result {
                        Ok(Ok(true)) => {},
                        Ok(Ok(false)) => break,
                        Ok(Err(error)) => tracing::warn!(error=?error, "scheduling recovery attempt failed"),
                        Err(error) => tracing::error!(error=?error, "scheduling recovery timed out; lease will expire"),
                    }
                }
            }
        }
        tokio::select! {
            _ = stop.cancelled() => return,
            _ = tokio::time::sleep(Duration::from_secs(15)) => {},
        }
    }
}
