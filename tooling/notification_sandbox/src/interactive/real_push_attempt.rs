use notification::domain::models::email_notification_digest::ports::{
    MessageId, NotificationSendChecker,
};
use rootcause::Report;

/// A push attempt that actually sends via AWS SNS.
///
/// Sends a minimal APNS payload to the given endpoint ARN and returns the real
/// SNS message ID.
pub struct RealSnsPushAttempt {
    /// The AWS SNS client.
    pub sns_client: aws_sdk_sns::Client,
    /// The target endpoint ARN.
    pub endpoint_arn: String,
}

impl NotificationSendChecker for RealSnsPushAttempt {
    type Ok = String;
    type Err = Report;

    async fn send_notification(self) -> Result<String, Report> {
        println!("  -> Sending real push to {}...", self.endpoint_arn);

        let payload = r#"{"APNS":"{\"aps\":{\"alert\":\"sandbox test\",\"sound\":\"default\"}}"}"#;

        let result = self
            .sns_client
            .publish()
            .target_arn(&self.endpoint_arn)
            .message(payload)
            .message_structure("json")
            .send()
            .await
            .map_err(|e| rootcause::report!("SNS publish failed: {e}"))?;

        let msg_id = result.message_id().unwrap_or_default().to_string();
        println!("  -> Real SNS message ID: {msg_id}");
        Ok(msg_id)
    }

    fn extract_message_id(res: &String) -> MessageId {
        MessageId(res.clone())
    }
}
