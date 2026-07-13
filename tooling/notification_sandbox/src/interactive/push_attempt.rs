use notification::domain::models::email_notification_digest::ports::{
    MessageId, NotificationSendChecker,
};
use rootcause::Report;

/// A mock push attempt that prompts the user to decide success or failure.
///
/// One instance is created per endpoint and consumed by StateMachineB.
pub struct InteractivePushAttempt {
    /// A human-readable name for the endpoint.
    pub endpoint_name: String,
}

impl NotificationSendChecker for InteractivePushAttempt {
    type Ok = String;
    type Err = Report;

    async fn send_notification(self) -> Result<String, Report> {
        let succeed =
            inquire::Confirm::new(&format!("Did push to \"{}\" succeed?", self.endpoint_name))
                .with_default(true)
                .prompt()
                .map_err(|e| rootcause::report!("{e}"))?;

        if succeed {
            let msg_id = format!("msg-{}", uuid::Uuid::new_v4());
            println!("  -> Generated message ID: {msg_id}");
            Ok(msg_id)
        } else {
            rootcause::bail!("simulated push failure for {}", self.endpoint_name)
        }
    }

    fn extract_message_id(res: &String) -> MessageId {
        MessageId(res.clone())
    }
}
