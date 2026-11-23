//! Time tracking changes over the connection gateway: one small message to
//! every open session of the person who made the change (another tab, their
//! phone). Delivery is best effort and never replayed, so the message is a
//! hint: it says whether the timer changed and which task's entries did, and
//! each session reads them again.

use connection_gateway_client::client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde_json::json;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use crate::domain::ports::{TimeTrackingChange, TimeTrackingUpdates};

#[cfg(test)]
mod test;

/// The gateway message type a session listens for.
pub const TIME_TRACKING_CHANGED: &str = "time_tracking_changed";

/// Sends time tracking changes to the person's sessions through the gateway.
#[derive(Clone)]
pub struct GatewayTimeTrackingUpdates {
    gateway: ConnectionGatewayClient,
    tasks: TaskTracker,
}

impl GatewayTimeTrackingUpdates {
    /// Construct over the shared gateway client. `tasks` is drained at
    /// shutdown, so a change committed just before still reaches the sessions.
    pub fn new(gateway: ConnectionGatewayClient, tasks: TaskTracker) -> Self {
        Self { gateway, tasks }
    }
}

/// What a session is told: whether to read the timer again, and the task
/// whose entries to read again, if any.
fn payload(change: &TimeTrackingChange) -> serde_json::Value {
    json!({
        "timer": change.timer,
        "taskId": change.task_id,
    })
}

impl TimeTrackingUpdates for GatewayTimeTrackingUpdates {
    fn changed(&self, user_id: &MacroUserIdStr<'static>, change: TimeTrackingChange) {
        let span = tracing::info_span!(
            "time.session_update",
            timer = change.timer,
            task_id = change.task_id.as_deref(),
            outcome = tracing::field::Empty,
        );
        let gateway = self.gateway.clone();
        let user_id = user_id.clone();
        // Spawned so the response never waits on the gateway; the change
        // already committed.
        self.tasks.spawn(
            async move {
                let sent = gateway
                    .send_message(
                        EntityType::User.with_entity_str(user_id.as_ref()),
                        TIME_TRACKING_CHANGED.to_owned(),
                        payload(&change),
                    )
                    .await;
                let span = tracing::Span::current();
                match sent {
                    Ok(_) => span.record("outcome", "sent"),
                    Err(error) => {
                        tracing::warn!(
                            error = ?error,
                            task_id = change.task_id.as_deref(),
                            "failed to send a time tracking update"
                        );
                        span.record("outcome", "failed")
                    }
                };
            }
            .instrument(span),
        );
    }
}
