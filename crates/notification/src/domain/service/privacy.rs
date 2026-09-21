//! Re-read privacy policy at delivery, including retries, fallback emails and VoIP.
//! Construct a fresh allowlisted payload rather than trying to blacklist sensitive fields.

use crate::domain::{
    models::{
        android::FCMMessage,
        apple::{APNSPushNotification, Alert, Aps, VoipPushPayload},
        mobile::{MessageAttributes, PushType},
        queue_message::EmailContent,
    },
    ports::{EmailSender, NotificationSender, VoipPushDelivery},
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::{Report, report};
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;
use workspace_privacy::domain::DisclosurePolicy;

/// Policy wrapper applied by every push composition root.
pub struct PrivatePushSender<M, P> {
    /// Actual delivery port.
    pub inner: M,
    /// Current disclosure policy.
    pub policy: P,
}

fn notification_id<T: Serialize>(data: &T) -> Option<Uuid> {
    let value = serde_json::to_value(data).ok()?;
    value.get("notificationId")?.as_str()?.parse().ok()
}

fn private_notification(id: Option<Uuid>) -> APNSPushNotification<Value> {
    APNSPushNotification {
        aps: Aps {
            alert: Some(Alert::Simple(
                "New activity in Macro. Open the app to view it.".to_owned(),
            )),
            // No mutable-content: the service extension must not rehydrate names or avatars.
            ..Aps::default()
        },
        push_notification_data: id
            .map(|id| json!({"notificationId": id}))
            .unwrap_or_else(|| json!({})),
    }
}

impl<M: NotificationSender, P: DisclosurePolicy> NotificationSender for PrivatePushSender<M, P> {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint: &str,
        notification: &APNSPushNotification<T>,
        attributes: &MessageAttributes,
    ) -> Result<String, Report> {
        let id = notification_id(&notification.push_notification_data);
        if !self
            .policy
            .restricted_push(endpoint, id)
            .await
            .unwrap_or(true)
        {
            return self
                .inner
                .send_ios_push_notification(endpoint, notification, attributes)
                .await;
        }
        let background = matches!(attributes.push_type, PushType::Background);
        let safe = if background {
            APNSPushNotification {
                aps: Aps {
                    content_available: Some(1),
                    sound: None,
                    ..Aps::default()
                },
                push_notification_data: json!({"identifier": "macro-private-activity"}),
            }
        } else {
            private_notification(id)
        };
        let attributes = MessageAttributes {
            push_type: if background {
                PushType::Background
            } else {
                PushType::Alert
            },
            collapse_key: "macro-private-activity".to_owned(),
        };
        self.inner
            .send_ios_push_notification(endpoint, &safe, &attributes)
            .await
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint: &str,
        notification: &FCMMessage<T>,
        attributes: &MessageAttributes,
    ) -> Result<String, Report> {
        // Android is still a placeholder; do not let an arbitrary data payload bypass policy.
        if self
            .policy
            .restricted_push(endpoint, None)
            .await
            .unwrap_or(true)
        {
            return Err(report!(
                "Android notification withheld by workspace privacy policy"
            ));
        }
        self.inner
            .send_android_push_notification(endpoint, notification, attributes)
            .await
    }
}

impl<M: VoipPushDelivery, P: DisclosurePolicy> VoipPushDelivery for PrivatePushSender<M, P> {
    async fn send_voip_push(
        &self,
        endpoint: &str,
        payload: &VoipPushPayload,
    ) -> Result<String, Report> {
        // Legacy VoIP carries names and a recipient LiveKit bearer token. It cannot be safely
        // reduced without changing native CallKit authentication. Return a failure so callers
        // can use their regular notification fallback; never report a fabricated delivery.
        if self
            .policy
            .restricted_push(endpoint, None)
            .await
            .unwrap_or(true)
        {
            return Err(report!(
                "VoIP notification withheld by workspace privacy policy"
            ));
        }
        self.inner.send_voip_push(endpoint, payload).await
    }
}

/// Applies to both immediate notification emails and delayed digest sends.
pub struct PrivateEmailSender<E, P> {
    /// Email delivery port.
    pub inner: E,
    /// Disclosure policy.
    pub policy: P,
}
impl<E: EmailSender, P: DisclosurePolicy> EmailSender for PrivateEmailSender<E, P> {
    async fn send_email(
        &self,
        recipient: MacroUserIdStr<'_>,
        content: &EmailContent,
    ) -> Result<(), Report> {
        // Legacy email envelopes have no source workspace. Conservatively redact all notification
        // emails when a protected workspace exists, until provenance is carried through digests.
        if self.policy.any_restricted_workspace().await.unwrap_or(true) {
            let safe = EmailContent {
                subject: "New activity in Macro".to_owned(),
                body: "<p>You have new activity in Macro. Open the app and sign in to view it.</p>"
                    .to_owned(),
            };
            return self.inner.send_email(recipient, &safe).await;
        }
        self.inner.send_email(recipient, content).await
    }
}

#[cfg(test)]
mod test;
