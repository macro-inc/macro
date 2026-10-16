//! Drain durable claims with a fixed bound; account caps and conversation order
//! are enforced by PostgreSQL across replicas, independently of these local slots.

use std::{sync::Arc, time::Duration};

use meta_messaging::{
    domain::{events::ReceiptBatch, meta::MetaService, service::MessagingService},
    inbound::webhook,
};
use tokio::{
    task::JoinSet,
    time::{MissedTickBehavior, interval},
};

const WORKER_SLOTS: usize = 4;

pub(super) async fn receipts(service: Arc<MetaService>) {
    let mut running = JoinSet::new();
    let mut tick = interval(Duration::from_millis(500));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        while running.len() < WORKER_SLOTS {
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
            _ = tick.tick() => {},
            result = running.join_next(), if !running.is_empty() => {
                if let Some(Err(error)) = result {
                    tracing::warn!(?error, "receipt task interrupted; durable lease will recover");
                }
            }
        }
    }
}

pub(super) async fn sends(service: MessagingService) {
    let mut running = JoinSet::new();
    let mut tick = interval(Duration::from_millis(500));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        while running.len() < WORKER_SLOTS {
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
            _ = tick.tick() => {},
            result = running.join_next(), if !running.is_empty() => {
                if let Some(Err(error)) = result {
                    tracing::warn!(?error, "reply task interrupted; durable lease will recover");
                }
            }
        }
    }
}

pub(super) async fn retention(service: Arc<MetaService>) {
    let mut tick = interval(Duration::from_secs(60));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        for _ in 0..4 {
            match service.repository.cleanup_receipts().await {
                Ok(counts) if counts.changed() => tracing::info!(
                    initialized = counts.completion_times_initialized,
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

pub(super) async fn temporary_media(
    copies: Arc<dyn meta_messaging::domain::temporary_media::TemporaryMedia>,
) {
    let mut tick = interval(Duration::from_secs(60));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        match copies.cleanup().await {
            Ok(counts) if counts.deleted + counts.deferred + counts.failed > 0 => {
                tracing::info!(
                    deleted = counts.deleted,
                    deferred = counts.deferred,
                    failed = counts.failed,
                    "temporary messaging media cleanup"
                );
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(error=?error.current_context(),"temporary messaging media cleanup will retry")
            }
        }
    }
}
