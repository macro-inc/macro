//! Migration request decoding and response conversion; policy belongs to Room.
use super::{SyncSession, response, room_error};
pub(crate) use sync_server_core::domain::migration::SnapshotProof;
use sync_server_core::domain::room::{FaultPlan, MigrationOutcome};
use worker::{Request, Response, Result};

/// The production build never reads fault headers.
pub(super) fn fault_plan(req: &Request) -> Result<FaultPlan> {
    #[cfg(feature = "migration-test-hooks")]
    {
        use sync_server_core::domain::room::FaultPoint;
        let point = match req.headers().get("x-sync-test-stop-after")?.as_deref() {
            Some("surface_snapshot") => FaultPoint::SurfaceSnapshot,
            Some("source_claim") => FaultPoint::SourceClaim,
            Some("source_export") => FaultPoint::SourceExport,
            Some("source_frozen") => FaultPoint::SourceFrozen,
            Some("source_thawed") => FaultPoint::SourceThawed,
            Some("source_sealed") => FaultPoint::SourceSealed,
            Some("source_retired") => FaultPoint::SourceRetired,
            Some("target_claim") => FaultPoint::TargetClaim,
            Some("target_snapshot") => FaultPoint::TargetSnapshot,
            Some("target_verified") => FaultPoint::TargetVerified,
            Some("target_active") => FaultPoint::TargetActive,
            Some("target_ready") => FaultPoint::TargetReady,
            _ => return Ok(FaultPlan::None),
        };
        Ok(FaultPlan::StopAfter(point))
    }
    #[cfg(not(feature = "migration-test-hooks"))]
    {
        let _ = req;
        Ok(FaultPlan::None)
    }
}
fn migration_response(outcome: MigrationOutcome) -> Result<Response> {
    match outcome {
        MigrationOutcome::BadRequest => Ok(response(400)),
        MigrationOutcome::Conflict => Ok(response(409)),
        MigrationOutcome::NotFound => Ok(response(404)),
        MigrationOutcome::Proof(proof) => Response::from_json(&proof),
        MigrationOutcome::Export(export) => Response::from_json(&export),
    }
}
impl SyncSession<'_> {
    pub(in crate::inbound) async fn source_migration_handler(
        &mut self,
        mut req: Request,
        id: &str,
        operation: &str,
    ) -> Result<Response> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Ok(response(400));
        }
        if !matches!(operation, "freeze" | "thaw" | "seal" | "retire") {
            return Ok(response(404));
        }
        let faults = fault_plan(&req)?;
        let Ok(body) = req.bytes().await else {
            return Ok(response(400));
        };
        migration_response(
            self.room
                .source_migration(&body, faults, id, operation)
                .await
                .map_err(room_error)?,
        )
    }
    pub(super) async fn target_migration_handler(
        &mut self,
        mut req: Request,
        key: &str,
        operation: &str,
    ) -> Result<Response> {
        let faults = fault_plan(&req)?;
        let Ok(body) = req.bytes().await else {
            return Ok(response(400));
        };
        migration_response(
            self.room
                .target_migration(&body, faults, key, operation)
                .await
                .map_err(room_error)?,
        )
    }
}
