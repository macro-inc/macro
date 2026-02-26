use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::email_notification_digest::ports::LastOnlineChecker;
use rootcause::Report;
use std::time::Duration;

/// Prompts the user to provide how long since a user was last online.
pub struct InteractiveLastOnlineChecker;

impl LastOnlineChecker for InteractiveLastOnlineChecker {
    async fn last_online_checker<'a>(&self, user: MacroUserIdStr<'a>) -> Result<Duration, Report> {
        let minutes: u64 =
            inquire::CustomType::new(&format!("Minutes since user \"{user}\" was last online?"))
                .with_default(60)
                .prompt()
                .map_err(|e| rootcause::report!("{e}"))?;
        Ok(Duration::from_secs(minutes * 60))
    }
}
