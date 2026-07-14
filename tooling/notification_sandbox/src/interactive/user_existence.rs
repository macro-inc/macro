use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::email_notification_digest::ports::UserExistenceChecker;
use rootcause::Report;

/// Prompts the user to decide whether a given user exists.
pub struct InteractiveUserExistenceChecker;

impl UserExistenceChecker for InteractiveUserExistenceChecker {
    async fn user_exists<'a>(&self, id: MacroUserIdStr<'a>) -> Result<bool, Report> {
        let exists = inquire::Confirm::new(&format!("Does user \"{id}\" have a Macro account?"))
            .with_default(true)
            .prompt()
            .map_err(|e| rootcause::report!("{e}"))?;
        Ok(exists)
    }
}
