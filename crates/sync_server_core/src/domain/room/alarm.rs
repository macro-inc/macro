//! Alarm snapshot, compaction and deferred blame policy.
use super::{PortName, Room, RoomError};
use crate::domain::{ports::*, types::InteractionReason};

/// The exact successful response selected for the durable alarm callback.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AlarmOutcome {
    /// Source is blocked or document load failed: empty response and no re-arm.
    Skipped,
    /// Processing completed: the response body is `ok`.
    Completed,
}

impl<P: RoomPorts> Room<P> {
    /// Persist changed state, then compact applied operations and flush blame.
    pub async fn on_alarm(&mut self) -> Result<AlarmOutcome, RoomError> {
        if self.source_blocked().await? {
            return Ok(AlarmOutcome::Skipped);
        }
        self.validate_surface_sockets(None).await?;
        // A failed state load must not retry the alarm or re-arm it (A3).
        if self.load_document().await.is_err() {
            return Ok(AlarmOutcome::Skipped);
        }
        if self
            .memory
            .document
            .as_ref()
            .expect("document loaded")
            .should_save()
        {
            self.ports
                .background()
                .extend_isolate_lifetime(self.config.isolate_keepalive);
            let document = self.memory.document.as_ref().expect("document loaded");
            let (state_frontiers, oplog_frontiers) = document.frontiers();
            let log = self.memory.operation_log.as_mut().expect("log initialized");
            log.store_snapshot(self.ports.storage(), self.ports.snapshots(), document)
                .await
                .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
            tracing::debug!(state_frontiers = ?state_frontiers, oplog_frontiers = ?oplog_frontiers, "Stored new DocumentState");
            log.clear_applied(self.ports.storage())
                .await
                .map_err(|e| RoomError::port(PortName::Storage, e))?;
            self.memory
                .document
                .as_mut()
                .expect("document loaded")
                .mark_exported(self.ports.clock().monotonic());

            // The former wait_until future captured the snapshot/editors on its
            // first poll, before another callback could take the barrier. Eager
            // capture under the same guard observes the same state and batch.
            let publication = self
                .session_key()
                .await
                .ok()
                .and_then(|key| {
                    self.memory
                        .document
                        .as_ref()
                        .expect("document loaded")
                        .export_shallow_snapshot()
                        .ok()
                        .map(|snapshot| (key, snapshot))
                })
                .map(|(key, snapshot)| {
                    let editors = std::mem::take(&mut self.memory.pending_editors)
                        .into_iter()
                        .collect();
                    match key.document() {
                        Some(document) => DocumentPublication::Snapshot {
                            document,
                            snapshot,
                            editors,
                            interaction: Some(InteractionReason::Edited),
                        },
                        None => DocumentPublication::Noop,
                    }
                })
                .unwrap_or(DocumentPublication::Noop);
            // Preserve scheduling even when exporting failed or the key is a surface.
            self.ports.background().publish(publication);
        }
        if !self.memory.pending_blame.is_empty() {
            self.ports
                .background()
                .record_blame(std::mem::take(&mut self.memory.pending_blame));
        }
        if !self.ports.connections().all().is_empty() {
            self.bump_alarm().await?;
        } else {
            tracing::info!("durable object has reached 0 connections");
        }
        Ok(AlarmOutcome::Completed)
    }
}
