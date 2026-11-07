use std::sync::{Arc, Mutex};

use chrono::{DateTime, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::request::NotificationResult;
use notification::domain::models::{Notification, SendNotificationRequest};
use notification::domain::service::SendNotificationError;
use rootcause::Report;
use serde::Serialize;
use uuid::Uuid;

use super::*;

const OWNER: &str = "macro|reminders-owner@macro.com";

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0)
        .single()
        .expect("unambiguous instant")
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER)
        .expect("valid user id")
        .into_owned()
}

fn reminder_id() -> Uuid {
    Uuid::from_bytes([7; 16])
}

fn due() -> DueReminder {
    DueReminder {
        reminder_id: reminder_id(),
        thread_id: Uuid::from_bytes([9; 16]),
        description: "Follow up on the contract".into(),
        owner_id: owner(),
        scheduled_for: now(),
    }
}

/// Captures the request as JSON. The request's fields are crate-private to
/// `notification`, but the whole thing is `Serialize` — which is also exactly
/// how it reaches the ingress queue, so asserting on the wire shape checks what
/// actually gets sent.
#[derive(Clone, Default)]
struct CapturingIngress {
    sent: Arc<Mutex<Vec<serde_json::Value>>>,
    fails: bool,
}

impl CapturingIngress {
    fn failing() -> Self {
        Self {
            sent: Arc::default(),
            fails: true,
        }
    }

    fn last(&self) -> serde_json::Value {
        self.sent
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("a notification was sent")
    }
}

impl NotificationIngress for CapturingIngress {
    async fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        if self.fails {
            return Err(rootcause::report!(SendNotificationError::Other));
        }
        self.sent
            .lock()
            .unwrap()
            .push(serde_json::to_value(&req).expect("request serializes"));
        Ok(None)
    }
}

#[tokio::test]
async fn sends_with_no_sender_so_the_owner_is_not_filtered_out() {
    let ingress = CapturingIngress::default();

    NotificationReminderNotifier::new(ingress.clone())
        .notify(&due())
        .await
        .expect("notify succeeds");

    let sent = ingress.last();
    // The single most breakable property: a recipient who is also the sender is
    // excluded from their own notification, and a reminder's only recipient is
    // the person who set it.
    assert_eq!(sent["req"]["sender_id"], serde_json::Value::Null);
    assert_eq!(
        sent["req"]["recipient_ids"],
        serde_json::json!([OWNER]),
        "the owner is the only recipient"
    );
}

#[tokio::test]
async fn addresses_the_notification_at_the_email_thread() {
    let ingress = CapturingIngress::default();

    NotificationReminderNotifier::new(ingress.clone())
        .notify(&due())
        .await
        .expect("notify succeeds");

    let entity = &ingress.last()["req"]["notification_entity"];
    assert_eq!(entity["entity_type"], "email_thread");
    assert_eq!(entity["entity_id"], due().thread_id.to_string());
}

#[tokio::test]
async fn carries_the_reminder_payload_under_the_reminder_tag() {
    let ingress = CapturingIngress::default();

    NotificationReminderNotifier::new(ingress.clone())
        .notify(&due())
        .await
        .expect("notify succeeds");

    let notification = &ingress.last()["req"]["notification"];
    assert_eq!(notification["tag"], ReminderMetadata::TYPE_NAME);
    assert_eq!(
        notification["content"]["reminderId"],
        reminder_id().to_string()
    );
    assert_eq!(
        notification["content"]["description"],
        "Follow up on the contract"
    );
    // The delivery timestamp identifies this snooze notification.
    assert_eq!(
        notification["content"]["scheduledFor"],
        "2026-07-01T12:00:00Z"
    );
}

#[tokio::test]
async fn requests_push_and_websocket_delivery() {
    let ingress = CapturingIngress::default();

    NotificationReminderNotifier::new(ingress.clone())
        .notify(&due())
        .await
        .expect("notify succeeds");

    let sent = ingress.last();
    assert_eq!(sent["send_conn_gateway"], true);
    assert!(
        !sent["build_apns"].is_null(),
        "an APNS payload must be built or mobile gets nothing"
    );
}

#[tokio::test]
async fn surfaces_a_rejected_send_as_an_error() {
    let result = NotificationReminderNotifier::new(CapturingIngress::failing())
        .notify(&due())
        .await;

    // The dispatcher relies on this to leave the firing uncompleted and
    // retryable rather than marking it delivered.
    assert!(result.is_err());
}
