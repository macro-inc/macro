use notification::domain::models::android::FCMMessage;
use notification::domain::models::apple::APNSPushNotification;
use notification::domain::models::mobile::MessageAttributes;
use notification::domain::ports::NotificationSender;
use notification::outbound::mobile::MobilePushAdapter;
use rootcause::Report;
use serde::Serialize;

/// Mobile push sender that interactively prompts the user for success/failure.
pub struct InteractiveMobileSender;

impl NotificationSender for InteractiveMobileSender {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        _notification: &APNSPushNotification<T>,
        _attributes: &MessageAttributes,
    ) -> Result<String, Report> {
        let succeeded =
            inquire::Confirm::new(&format!("Did push to \"{endpoint_arn}\" succeed?"))
                .with_default(true)
                .prompt()
                .map_err(|e| rootcause::report!("{e}"))?;

        if succeeded {
            let msg_id = format!("mock-msg-{}", uuid::Uuid::new_v4());
            println!("  -> SUCCESS (message_id: {msg_id})");
            Ok(msg_id)
        } else {
            println!("  -> FAILED");
            rootcause::bail!("Simulated push failure for {endpoint_arn}");
        }
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        _notification: &FCMMessage<T>,
        _attributes: &MessageAttributes,
    ) -> Result<String, Report> {
        let msg_id = format!("mock-msg-{}", uuid::Uuid::new_v4());
        println!("  [egress] Android push: endpoint={endpoint_arn} -> message_id={msg_id}");
        Ok(msg_id)
    }
}

/// Dispatches between interactive (mock) and real SNS mobile push.
pub enum SandboxMobileSender {
    /// Interactive mode: prompts user for success/failure.
    Interactive(InteractiveMobileSender),
    /// Real mode: sends via AWS SNS.
    Real(MobilePushAdapter<aws_sdk_sns::Client>),
}

impl NotificationSender for SandboxMobileSender {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &APNSPushNotification<T>,
        attributes: &MessageAttributes,
    ) -> Result<String, Report> {
        match self {
            Self::Interactive(m) => {
                m.send_ios_push_notification(endpoint_arn, notification, attributes)
                    .await
            }
            Self::Real(r) => {
                r.send_ios_push_notification(endpoint_arn, notification, attributes)
                    .await
            }
        }
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &FCMMessage<T>,
        attributes: &MessageAttributes,
    ) -> Result<String, Report> {
        match self {
            Self::Interactive(m) => {
                m.send_android_push_notification(endpoint_arn, notification, attributes)
                    .await
            }
            Self::Real(r) => {
                r.send_android_push_notification(endpoint_arn, notification, attributes)
                    .await
            }
        }
    }
}
