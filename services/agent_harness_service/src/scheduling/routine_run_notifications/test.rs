use std::sync::Mutex;

use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::request::NotificationResult;
use notification::domain::models::{Notification, SendNotificationRequest};
use notification::domain::service::SendNotificationError;
use rootcause::Report;
use scheduled_action::domain::ports::{RunTarget, RunTrigger};
use serde::Serialize;
use serde_json::json;

use super::*;

const OWNER: &str = "macro|owner@example.com";

#[derive(Default)]
struct CapturingIngress(Mutex<Vec<serde_json::Value>>);

impl NotificationIngress for CapturingIngress {
    async fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        self.0
            .lock()
            .unwrap()
            .push(serde_json::to_value(&req).expect("request serializes"));
        Ok(None)
    }
}

/// Report a run that ended with `end`, and return what was sent once the
/// send settles.
async fn sent(end: RunEnd) -> Vec<serde_json::Value> {
    let ingress = Arc::new(CapturingIngress::default());
    let tracker = TaskTracker::new();
    let notifications = RoutineRunNotifications::new(Arc::clone(&ingress), tracker.clone());

    notifications.run_finished(FinishedRoutineRun {
        owner: MacroUserIdStr::parse_from_str(OWNER).unwrap(),
        routine_id: uuid::Uuid::nil(),
        routine_name: "Morning brief".to_string(),
        trigger: RunTrigger::Scheduled,
        target: RunTarget::Agent,
        end,
        duration: chrono::Duration::seconds(3),
    });
    tracker.close();
    tracker.wait().await;

    ingress.0.lock().unwrap().clone()
}

#[tokio::test]
async fn a_successful_run_notifies_its_owner_in_the_inbox_only() {
    let sent = sent(RunEnd::Succeeded).await;

    assert_eq!(sent.len(), 1);
    let request = &sent[0];
    assert_eq!(request["req"]["recipient_ids"], json!([OWNER]));
    assert_eq!(request["req"]["sender_id"], json!(null));
    assert_eq!(
        request["req"]["notification"]["tag"],
        "routine_run_finished"
    );
    assert_eq!(
        request["req"]["notification"]["content"],
        json!({
            "routineId": uuid::Uuid::nil(),
            "routineName": "Morning brief",
            "outcome": "succeeded",
        })
    );
    assert_eq!(request["build_apns"], json!(null), "no phone push");
}

#[tokio::test]
async fn every_run_that_did_not_succeed_notifies_as_failed() {
    for end in [RunEnd::Failed, RunEnd::Interrupted, RunEnd::AiLimitReached] {
        let sent = sent(end).await;
        assert_eq!(sent.len(), 1, "{end:?}");
        assert_eq!(
            sent[0]["req"]["notification"]["content"]["outcome"], "failed",
            "{end:?}"
        );
    }
}
