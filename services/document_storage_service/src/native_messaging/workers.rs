//! Drain durable claims with a fixed bound. PostgreSQL preserves conversation
//! order across replicas; a busy account may occupy every local worker slot.

use std::{sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

use meta_messaging::{
    domain::{events::ReceiptBatch, meta::MetaService, service::MessagingService},
    inbound::webhook,
};
use tokio::{
    sync::Notify,
    task::JoinSet,
    time::{Instant, MissedTickBehavior, interval, interval_at},
};

const WORKER_SLOTS: usize = 4;
/// Cross-replica, retry and restart recovery deadline when a local signal is absent.
pub(super) const SWEEP_INTERVAL: Duration = Duration::from_secs(5);

pub(super) async fn receipts(
    service: Arc<MetaService>,
    ready: Arc<Notify>,
    cancellation: CancellationToken,
) {
    let mut running = JoinSet::new();
    let mut tick = interval_at(Instant::now() + SWEEP_INTERVAL, SWEEP_INTERVAL);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        while running.len() < WORKER_SLOTS && !cancellation.is_cancelled() {
            let work = match service.repository.claim_receipt().await {
                Ok(Some(work)) => work,
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(error=?error.current_context(), "receipt claim will retry");
                    break;
                }
            };
            let service = service.clone();
            running.spawn(async move {
                let batch = webhook::decode(work.provider, &work.payload).unwrap_or_else(|_| {
                    ReceiptBatch {
                        events: Vec::new(),
                        invalid_items: 1,
                    }
                });
                if let Err(error) = service.process_receipt_attempt(&work, batch).await {
                    tracing::warn!(error=?error.current_context(), "receipt lease will recover");
                }
            });
        }
        tokio::select! {
            _ = cancellation.cancelled() => {
                while let Some(result)=running.join_next().await {
                    if let Err(error)=result { tracing::warn!(?error,"messaging task interrupted during shutdown; durable lease will recover"); }
                }
                return;
            },
            _ = tick.tick() => {},
            _ = ready.notified() => {},
            result = running.join_next(), if !running.is_empty() => {
                if let Some(Err(error)) = result {
                    tracing::warn!(?error, "receipt task interrupted; durable lease will recover");
                }
            }
        }
    }
}

pub(super) async fn sends(
    service: MessagingService,
    ready: Arc<Notify>,
    cancellation: CancellationToken,
) {
    let mut running = JoinSet::new();
    let mut tick = interval_at(Instant::now() + SWEEP_INTERVAL, SWEEP_INTERVAL);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        while running.len() < WORKER_SLOTS && !cancellation.is_cancelled() {
            let work = match service.repository.claim_send().await {
                Ok(Some(work)) => work,
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(error=?error.current_context(), "reply claim will retry");
                    break;
                }
            };
            let service = service.clone();
            running.spawn(async move {
                if let Err(error) = service.process_send(&work).await {
                    tracing::warn!(error=?error.current_context(), "reply attempt remains durably settled or leased");
                }
            });
        }
        tokio::select! {
            _ = cancellation.cancelled() => {
                while let Some(result)=running.join_next().await {
                    if let Err(error)=result { tracing::warn!(?error,"messaging task interrupted during shutdown; durable lease will recover"); }
                }
                return;
            },
            _ = tick.tick() => {},
            _ = ready.notified() => {},
            result = running.join_next(), if !running.is_empty() => {
                if let Some(Err(error)) = result {
                    tracing::warn!(?error, "reply task interrupted; durable lease will recover");
                }
            }
        }
    }
}

pub(super) async fn retention(service: Arc<MetaService>, cancellation: CancellationToken) {
    let mut tick = interval(Duration::from_secs(60));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! { _=cancellation.cancelled()=>return, _=tick.tick()=>{} }
        for _ in 0..4 {
            match service.repository.cleanup_receipts().await {
                Ok(counts) if counts.changed() => tracing::info!(
                    oauth_deleted = counts.oauth_deleted,
                    cleared = counts.payloads_cleared,
                    expired = counts.work_expired,
                    deleted = counts.receipts_deleted,
                    "messaging receipt retention applied"
                ),
                Ok(_) => break,
                Err(error) => {
                    tracing::warn!(error=?error.current_context(),"messaging receipt cleanup will retry");
                    break;
                }
            }
        }
    }
}
