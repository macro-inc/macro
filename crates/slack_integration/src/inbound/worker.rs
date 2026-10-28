//! Bounded queue driver. Domain services own claims, durable outcomes and recovery.
//! No detached import futures survive shutdown or loss of a heartbeat.

use std::{future::Future, time::Duration};

use futures::future::join_all;
use tokio::time::{Instant, MissedTickBehavior, interval_at, sleep, timeout};
use tokio_util::sync::CancellationToken;

use crate::domain::{
    maintenance::Maintenance,
    models::*,
    ports::{ImportConsumer, ImportWorker, PortResult},
};

#[cfg(test)]
mod test;

/// Validated operational bounds. A restart changes enablement; disabled instances
/// still reconcile DLQ records, expired/cancelled leases and dirty search work.
#[derive(Clone, Copy)]
pub struct WorkerConfig {
    enabled: bool,
    concurrency: u8,
    max_receives: u32,
    heartbeat: Duration,
    operation_timeout: Duration,
    retry_delay: Duration,
    maintenance_interval: Duration,
    drain_timeout: Duration,
}

impl WorkerConfig {
    /// Default to one import at a time; permit at most two. Reserve ten seconds
    /// of the task's 120-second stop budget for runtime/telemetry teardown.
    pub fn new(enabled: bool, concurrency: u8, max_receives: u32) -> Result<Self, ImportError> {
        if !(1..=2).contains(&concurrency) || max_receives == 0 {
            return Err(ImportError::InvalidInput);
        }
        Ok(Self {
            enabled,
            concurrency,
            max_receives,
            heartbeat: Duration::from_secs(60),
            operation_timeout: Duration::from_secs(30),
            retry_delay: Duration::from_secs(5),
            maintenance_interval: Duration::from_secs(10),
            drain_timeout: Duration::from_secs(110),
        })
    }
}

/// Run independent claim, publication, recovery and DLQ loops. On cancellation,
/// stop receiving immediately and drain active imports with heartbeats intact.
/// At the deadline drop all futures: committed checkpoints and expired fenced
/// leases are recovered by another instance, never acknowledged speculatively.
pub async fn run(
    work: &impl ImportWorker,
    maintenance: &impl Maintenance,
    queue: &impl ImportConsumer,
    owner: WorkerId,
    config: WorkerConfig,
    stop: CancellationToken,
) {
    let lanes = async {
        if config.enabled {
            join_all(
                (0..config.concurrency)
                    .map(|_| consume(work, maintenance, queue, owner, config, &stop, false)),
            )
            .await;
        }
    };
    let loops = async {
        tokio::join!(
            lanes,
            consume(work, maintenance, queue, owner, config, &stop, true),
            maintain(maintenance, config, &stop, false),
            maintain(maintenance, config, &stop, true),
        );
    };
    tokio::pin!(loops);
    tokio::select! {
        biased;
        _ = stop.cancelled() => (),
        _ = &mut loops => return,
    }
    if timeout(config.drain_timeout, loops).await.is_err() {
        tracing::warn!(
            operation = "shutdown",
            outcome = "checkpoint_recovery",
            "slack import drain deadline"
        );
    }
}

async fn consume(
    work: &impl ImportWorker,
    maintenance: &impl Maintenance,
    queue: &impl ImportConsumer,
    owner: WorkerId,
    config: WorkerConfig,
    stop: &CancellationToken,
    dead_letter: bool,
) {
    loop {
        let received = tokio::select! {
            biased;
            _ = stop.cancelled() => return,
            result = bounded(config, queue.receive(dead_letter)) => result,
        };
        if stop.is_cancelled() {
            return;
        }
        match received {
            Ok(Some(delivery)) => {
                let result = handle(
                    work,
                    maintenance,
                    queue,
                    &delivery,
                    owner,
                    config,
                    dead_letter,
                )
                .await;
                match result {
                    Ok(WorkerOutcome::Acknowledge) => {
                        report("delete", bounded(config, queue.delete(&delivery)).await);
                    }
                    Ok(WorkerOutcome::Defer) => {
                        tracing::info!(
                            operation = "delivery",
                            outcome = "deferred",
                            dead_letter,
                            "slack import delivery"
                        );
                    }
                    Err(error) => report("delivery", Err(error)),
                }
            }
            Ok(None) => (),
            Err(error) => {
                report("receive", Err(error));
                tokio::select! {
                    _ = stop.cancelled() => return,
                    _ = sleep(config.retry_delay) => (),
                }
            }
        }
    }
}

async fn handle<Q: ImportConsumer>(
    work: &impl ImportWorker,
    maintenance: &impl Maintenance,
    queue: &Q,
    delivery: &Q::Delivery,
    owner: WorkerId,
    config: WorkerConfig,
    dead_letter: bool,
) -> PortResult<WorkerOutcome> {
    let (event, receive_count) = Q::envelope(delivery);
    let event = match event {
        Ok(event) => event,
        Err(code) => {
            tracing::warn!(
                ?code,
                dead_letter,
                operation = "malformed",
                "slack import invalid envelope"
            );
            // Main poison messages redrive to DLQ for a separate sanitized signal.
            // No trusted identity exists to update. Never log the raw payload.
            return Ok(if dead_letter {
                WorkerOutcome::Acknowledge
            } else {
                WorkerOutcome::Defer
            });
        }
    };
    let process = async {
        if dead_letter || receive_count >= config.max_receives {
            return bounded(config, maintenance.dead_letter(&event)).await;
        }
        match bounded(config, work.claim(&event, owner)).await? {
            ClaimOutcome::Obsolete => Ok(WorkerOutcome::Acknowledge),
            ClaimOutcome::ActiveLease => Ok(WorkerOutcome::Defer),
            ClaimOutcome::Claimed(context) => {
                // These futures are polled independently of storage reads, target
                // resolution and batch commits. A failed renewal drops the importer.
                tokio::select! {
                    biased;
                    result = heartbeat(config, || async { work.heartbeat(&context.lease).await.map(|_| ()) }) => result,
                    result = work.import(&context) => result,
                }
            }
        }
    };
    tokio::select! {
        biased;
        result = heartbeat(config, || queue.extend(delivery)) => result,
        result = process => result,
    }
}

async fn heartbeat<F, Fut>(config: WorkerConfig, mut renew: F) -> PortResult<WorkerOutcome>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = PortResult<()>>,
{
    let mut ticks = interval_at(Instant::now() + config.heartbeat, config.heartbeat);
    ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        bounded(config, renew()).await?;
    }
}

async fn maintain(
    service: &impl Maintenance,
    config: WorkerConfig,
    stop: &CancellationToken,
    publication: bool,
) {
    if publication && !config.enabled {
        return;
    }
    let operation = if publication { "outbox" } else { "reconcile" };
    loop {
        tokio::select! {
            biased;
            _ = stop.cancelled() => return,
            result = bounded(config, async {
                if publication { service.publish().await } else { service.reconcile().await }
            }) => report(operation, result),
        }
        tokio::select! {
            _ = stop.cancelled() => return,
            _ = sleep(config.maintenance_interval) => (),
        }
    }
}

async fn bounded<T>(
    config: WorkerConfig,
    operation: impl Future<Output = PortResult<T>>,
) -> PortResult<T> {
    timeout(config.operation_timeout, operation)
        .await
        .map_err(|_| ImportError::Retryable)?
}

fn report(operation: &'static str, result: PortResult<()>) {
    match result {
        Ok(()) => tracing::info!(operation, outcome = "success", "slack import operation"),
        Err(error) => {
            tracing::warn!(operation, code = ?error.current_context(), "slack import retry")
        }
    }
}
