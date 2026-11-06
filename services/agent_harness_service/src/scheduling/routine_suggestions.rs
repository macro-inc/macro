//! Where routine suggestions read the person's accounts from.

use std::sync::Arc;

use email_service_client::EmailServiceClient;
use macro_user_id::user_id::MacroUserIdStr;
use scheduled_action::domain::suggestions::ports::{InboxMessage, SuggestionSources};

/// The newest mail through email_service, which reads it from Gmail and
/// Outlook, and the person's inboxes from MacroDB.
pub struct HarnessSuggestionSources {
    pub email: Arc<EmailServiceClient>,
    pub db: sqlx::PgPool,
}

impl SuggestionSources for HarnessSuggestionSources {
    async fn inbox(
        &self,
        user: &MacroUserIdStr<'static>,
        limit: u16,
    ) -> anyhow::Result<Vec<InboxMessage>> {
        let response = self
            .email
            .get_recent_inbox_messages(user.as_ref(), limit)
            .await?;
        Ok(response
            .messages
            .into_iter()
            .map(|message| InboxMessage {
                from: message.from.map(|from| match from.name {
                    Some(name) if !name.trim().is_empty() => format!("{name} <{}>", from.email),
                    _ => from.email,
                }),
                subject: message.subject,
                snippet: message.snippet,
                received_at: message.received_at,
            })
            .collect())
    }

    async fn inbox_ids(&self, user: &MacroUserIdStr<'static>) -> anyhow::Result<Vec<String>> {
        let inboxes =
            email_db_client::links::get::fetch_readable_owned_inboxes(&self.db, user).await?;
        Ok(inboxes
            .into_iter()
            .map(|inbox| inbox.id.to_string())
            .collect())
    }

    /// Detected tools arrive with onboarding's tool suggestions (#9893);
    /// until then a generation reads none.
    async fn tools(&self, _: &MacroUserIdStr<'static>) -> anyhow::Result<Vec<String>> {
        Ok(Vec::new())
    }
}
