//! Settlement heals an injected source freeze through the real receipt-checked route.
use super::*;
use sync_server_core::domain::{
    migration::SourceState,
    ports::RoomStorage,
    room::{FaultPlan, MigrationOutcome},
};

impl SimServer {
    pub(super) async fn thaw_source(&mut self) -> Result<(), Failure> {
        let state = self
            .ports
            .source_migration()
            .await
            .map_err(|error| Failure::new("source_thaw", error))?;
        let proof = match state {
            Some(SourceState::Frozen(proof)) => proof,
            Some(SourceState::Freezing(operation_id)) => {
                let body = serde_json::to_vec(&serde_json::json!({ "operation_id": operation_id }))
                    .map_err(|error| Failure::new("source_thaw", error))?;
                let outcome = self
                    .room
                    .room_mut()
                    .source_migration(&body, FaultPlan::None, self.key.as_str(), "freeze")
                    .await
                    .map_err(|error| Failure::new("source_thaw", error))?;
                let MigrationOutcome::Export(export) = outcome else {
                    return Err(Failure::new(
                        "source_thaw",
                        "interrupted freeze did not resume",
                    ));
                };
                export.proof
            }
            _ => return Ok(()),
        };
        let body =
            serde_json::to_vec(&proof).map_err(|error| Failure::new("source_thaw", error))?;
        let outcome = self
            .room
            .room_mut()
            .source_migration(&body, FaultPlan::None, self.key.as_str(), "thaw")
            .await
            .map_err(|error| Failure::new("source_thaw", error))?;
        if !matches!(outcome, MigrationOutcome::Proof(actual) if actual == proof) {
            return Err(Failure::new(
                "source_thaw",
                "real migration thaw rejected frozen receipt",
            ));
        }
        Ok(())
    }
}
