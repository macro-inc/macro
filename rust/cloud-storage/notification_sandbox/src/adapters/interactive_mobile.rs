use notification::domain::models::android::FCMMessage;
use notification::domain::models::apple::APNSPushNotification;
use notification::domain::models::mobile::MessageAttributes;
use notification::domain::ports::NotificationSender;
use notification::outbound::mobile::MobilePushAdapter;
use rootcause::Report;
use serde::Serialize;
use tokio::sync::mpsc;

/// A prompt request sent from the background egress task to the foreground.
pub struct PushPromptRequest {
    /// The endpoint ARN being pushed to.
    pub endpoint_arn: String,
    /// Channel to send back whether the push "succeeded".
    pub reply: tokio::sync::oneshot::Sender<bool>,
}

/// Mobile push sender that delegates interactive prompts to the foreground via a channel.
pub struct InteractiveMobileSender {
    /// Sender half — sends prompt requests to the foreground loop.
    pub prompt_tx: mpsc::UnboundedSender<PushPromptRequest>,
}

impl NotificationSender for InteractiveMobileSender {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        _notification: &APNSPushNotification<T>,
        _attributes: &MessageAttributes,
    ) -> Result<String, Report> {
        let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
        self.prompt_tx
            .send(PushPromptRequest {
                endpoint_arn: endpoint_arn.to_string(),
                reply: reply_tx,
            })
            .map_err(|_| rootcause::report!("foreground prompt channel closed"))?;

        let succeeded = reply_rx
            .await
            .map_err(|_| rootcause::report!("foreground prompt reply dropped"))?;

        if succeeded {
            let msg_id = format!("mock-msg-{}", uuid::Uuid::new_v4());
            Ok(msg_id)
        } else {
            rootcause::bail!("Simulated push failure for {endpoint_arn}");
        }
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        _endpoint_arn: &str,
        _notification: &FCMMessage<T>,
        _attributes: &MessageAttributes,
    ) -> Result<String, Report> {
        let msg_id = format!("mock-msg-{}", uuid::Uuid::new_v4());
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
