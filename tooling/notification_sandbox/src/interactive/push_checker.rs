use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::email_notification_digest::ports::PushNotificationChecker;
use rootcause::Report;

/// Prompts the user to decide whether push notifications are enabled for a user.
pub struct InteractivePushNotificationChecker;

impl PushNotificationChecker for InteractivePushNotificationChecker {
    async fn push_notification_enabled<'a>(
        &self,
        user: MacroUserIdStr<'a>,
    ) -> Result<bool, Report> {
        let enabled = inquire::Confirm::new(&format!(
            "Does user \"{user}\" have push notifications enabled?"
        ))
        .with_default(true)
        .prompt()
        .map_err(|e| rootcause::report!("{e}"))?;
        Ok(enabled)
    }
}
