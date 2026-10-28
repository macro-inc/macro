//! Work feed triggers from the notification, activity and Soup realtime
//! streams a viewer already receives.

use std::sync::Arc;

use activity::{Action, ActivitySubscriptionService, ActivitySubscriptionUpdate, RecordedAction};
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::NotifEvent;
use notification::domain::{
    models::NotificationSubscriptionUpdate, ports::WebSocketNotificationSubscriptionService,
};
use soup_realtime::domain::{models::Patch, ports::SoupRealtimeSubscriptionService};
use tokio::sync::mpsc;

use crate::domain::{
    models::WorkFeedTrigger, ports::WorkFeedTriggers, realtime::notification_trigger_keys,
};

/// Triggers buffered per subscriber before upstream reads wait.
const TRIGGER_BUFFER: usize = 64;

/// Merges a viewer's realtime streams into work feed triggers.
pub struct RealtimeWorkFeedTriggers<NS, AS, R> {
    notifications: Arc<NS>,
    activity: Arc<AS>,
    soup: Arc<R>,
}

impl<NS, AS, R> RealtimeWorkFeedTriggers<NS, AS, R> {
    /// Create the adapter over the three realtime subscription services.
    pub fn new(notifications: Arc<NS>, activity: Arc<AS>, soup: Arc<R>) -> Self {
        Self {
            notifications,
            activity,
            soup,
        }
    }
}

/// The trigger an activity update implies for `user`: only the viewer's own
/// non-view actions change own work.
fn activity_trigger(
    user: &MacroUserIdStr<'static>,
    update: ActivitySubscriptionUpdate,
) -> Option<WorkFeedTrigger> {
    match update {
        ActivitySubscriptionUpdate::Updated(record) => {
            let own = record.subject_id == user.as_ref();
            let viewed = matches!(record.action, RecordedAction::Known(Action::Opened));
            (own && !viewed).then(|| {
                WorkFeedTrigger::Changed(vec![
                    record
                        .entity_type
                        .with_entity_string(record.entity_id.clone()),
                ])
            })
        }
        ActivitySubscriptionUpdate::Invalidated => Some(WorkFeedTrigger::Invalidated),
    }
}

fn notification_trigger(update: NotificationSubscriptionUpdate<NotifEvent>) -> WorkFeedTrigger {
    match update {
        NotificationSubscriptionUpdate::New(row) | NotificationSubscriptionUpdate::Updated(row) => {
            WorkFeedTrigger::Changed(notification_trigger_keys(&row))
        }
        // A deleted row no longer names its entity; refetching is the only
        // way to learn which item lost a reason.
        NotificationSubscriptionUpdate::Deleted(_) => WorkFeedTrigger::Invalidated,
    }
}

impl<NS, AS, R> WorkFeedTriggers for RealtimeWorkFeedTriggers<NS, AS, R>
where
    NS: WebSocketNotificationSubscriptionService<NotificationSubscriptionUpdate<NotifEvent>>,
    AS: ActivitySubscriptionService,
    R: SoupRealtimeSubscriptionService,
{
    fn subscribe(&self, user: MacroUserIdStr<'static>) -> mpsc::Receiver<WorkFeedTrigger> {
        let (sender, receiver) = mpsc::channel(TRIGGER_BUFFER);
        let mut notifications = self.notifications.subscribe(user.clone());
        let mut activity = self.activity.subscribe(user.clone());
        let mut soup = self.soup.subscribe(user.clone());
        tokio::spawn(async move {
            loop {
                let trigger = tokio::select! {
                    () = sender.closed() => return,
                    update = notifications.recv() => match update {
                        Some(update) => Some(notification_trigger(update)),
                        None => break,
                    },
                    update = activity.recv() => match update {
                        Some(update) => activity_trigger(&user, update),
                        None => break,
                    },
                    patch = soup.recv() => match patch {
                        Some(Patch::Updated(entity) | Patch::Deleted(entity)) => {
                            Some(WorkFeedTrigger::Changed(vec![entity]))
                        }
                        None => break,
                    },
                };
                if let Some(trigger) = trigger
                    && sender.send(trigger).await.is_err()
                {
                    return;
                }
            }
            // An upstream stream ended, normally or after falling behind:
            // changes may have been missed, so subscribers must refetch.
            let _ = sender.send(WorkFeedTrigger::Invalidated).await;
        });
        receiver
    }
}
