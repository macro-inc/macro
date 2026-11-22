//! Explicit test fault selection; production adapters always supply None.
use super::RoomError;
/// Durable boundary where a test may stop a migration callback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultPoint {
    /// Legacy binary surface seed persisted.
    SurfaceSnapshot,
    /// Source claim persisted.
    SourceClaim,
    /// Frozen export persisted.
    SourceExport,
    /// Frozen receipt persisted.
    SourceFrozen,
    /// Thaw persisted.
    SourceThawed,
    /// Seal persisted.
    SourceSealed,
    /// Retirement persisted.
    SourceRetired,
    /// Target claim persisted.
    TargetClaim,
    /// Target seed persisted.
    TargetSnapshot,
    /// Verification receipt persisted.
    TargetVerified,
    /// Target activation persisted.
    TargetActive,
    /// Ready lifecycle persisted.
    TargetReady,
}
/// Fault input chosen by an adapter with test hooks enabled.
#[derive(Default, Debug, Clone, Copy)]
pub enum FaultPlan {
    /// Normal production behavior.
    #[default]
    None,
    /// Return the legacy injected error immediately after this write.
    StopAfter(FaultPoint),
}
impl FaultPlan {
    pub(super) fn at(self, point: FaultPoint) -> Result<(), RoomError> {
        if matches!(self, Self::StopAfter(expected) if expected == point) {
            if point == FaultPoint::SurfaceSnapshot {
                Err(RoomError::InjectedSurfacePersistence)
            } else {
                Err(RoomError::InjectedMigrationPersistence)
            }
        } else {
            Ok(())
        }
    }
}
