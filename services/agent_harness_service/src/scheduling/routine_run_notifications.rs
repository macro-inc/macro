//! Tells a routine's owner about every run it finishes: one
//! `routine_run_finished` notification per run, saying whether it succeeded or
//! failed. These land in the inbox only: the app never pops them up as alerts,
//! and they send no phone push.

#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::sync::Arc;

use entity_kind::EntityType;
use model_notifications::{RoutineRunFinishedMetadata, RoutineRunOutcome};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use scheduled_action::domain::ports::{FinishedRoutineRun, RoutineRunObserver, RunEnd};
use tokio_util::task::TaskTracker;
use tracing::Instrument;

/// Sends routine run notifications through the notification ingress.
pub struct RoutineRunNotifications<Ingress> {
    ingress: Arc<Ingress>,
    tracker: TaskTracker,
}

impl<Ingress> Clone for RoutineRunNotifications<Ingress> {
    fn clone(&self) -> Self {
        Self {
            ingress: Arc::clone(&self.ingress),
            tracker: self.tracker.clone(),
        }
    }
}

impl<Ingress: NotificationIngress> RoutineRunNotifications<Ingress> {
    /// Sends run on `tracker`, so shutdown waits for them.
    pub fn new(ingress: Arc<Ingress>, tracker: TaskTracker) -> Self {
        Self { ingress, tracker }
    }

    #[tracing::instrument(name = "routine.notify_run", skip_all, fields(routine_id = %run.routine_id))]
    async fn notify(&self, run: FinishedRoutineRun) {
        let outcome = match run.end {
            RunEnd::Succeeded => RoutineRunOutcome::Succeeded,
            RunEnd::Failed | RunEnd::Interrupted | RunEnd::AiLimitReached => {
                RoutineRunOutcome::Failed
            }
        };
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::ScheduledAction
                .with_entity_string(run.routine_id.to_string()),
            secondary_notification_entity: None,
            notification: RoutineRunFinishedMetadata {
                routine_id: run.routine_id,
                // A sub-routine's run names the routine it follows.
                routine_name: match run.parent_name {
                    Some(parent) => format!("{} · from {parent}", run.routine_name),
                    None => run.routine_name,
                },
                outcome,
            },
            sender_id: None,
            recipient_ids: HashSet::from([run.owner]),
        }
        .into_request()
        .with_conn_gateway();
        let _ = self
            .ingress
            .send_notification(request)
            .await
            .inspect_err(|error| {
                tracing::warn!(?error, routine_id = %run.routine_id, "failed to enqueue a routine run notification");
            });
    }
}

impl<Ingress: NotificationIngress> RoutineRunObserver for RoutineRunNotifications<Ingress> {
    fn run_finished(&self, run: FinishedRoutineRun) {
        let notifications = self.clone();
        // Parent on the run's span so the send stays in the run's trace.
        self.tracker
            .spawn(async move { notifications.notify(run).await }.in_current_span());
    }
}
