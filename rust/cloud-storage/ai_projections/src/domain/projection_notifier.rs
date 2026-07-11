//! Outbound port for pushing projection state changes to connected clients.

use crate::domain::model::{TargetType, UserAiProjection};

/// Pushes a projection instance's latest state to the target's connected
/// clients (e.g. through the connection gateway) after a materialization
/// attempt completes, so the frontend can update without polling.
pub trait ProjectionNotifier: Clone + Send + Sync + 'static {
    /// Notifies the target's connected clients that `instance` changed.
    fn notify_updated(
        &self,
        target_type: TargetType,
        instance: &UserAiProjection,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
