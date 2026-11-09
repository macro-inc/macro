//! Where routine suggestions read the person's accounts from.

use std::sync::Arc;

use agent_session::domain::routines::ConnectedApps;
use email_service_client::EmailServiceClient;
use macro_user_id::user_id::MacroUserIdStr;
use scheduled_action::domain::suggestions::ports::{InboxMessage, SuggestionSources};

use crate::routine_sessions::PipedreamConnectedApps;

/// Snippet length suggestions read: past the provider's preview, from the
/// body.
const SNIPPET_CHARS: u16 = 500;

/// The newest mail through email_service, which reads it from Gmail and
/// Outlook, and the apps the person connected through Pipedream.
pub struct HarnessSuggestionSources<Connections> {
    pub email: Arc<EmailServiceClient>,
    pub apps: PipedreamConnectedApps<Connections>,
}

impl<Connections> SuggestionSources for HarnessSuggestionSources<Connections>
where
    Connections: pipedream_mcp::domain::ports::ConnectionStore,
{
    async fn inbox(
        &self,
        user: &MacroUserIdStr<'static>,
        limit: u16,
    ) -> anyhow::Result<Vec<InboxMessage>> {
        let response = self
            .email
            .get_recent_inbox_messages_with_snippets(user.as_ref(), limit, Some(SNIPPET_CHARS))
            .await?;
        Ok(response
            .messages
            .into_iter()
            .map(|message| InboxMessage {
                from: message.from.map(|from| match from.name {
                    Some(name) if !name.trim().is_empty() => format!("{name} <{}>", from.email),
                    _ => from.email,
                }),
                to: message.to,
                subject: message.subject,
                labels: message.labels,
                snippet: message.snippet,
                received_at: message.received_at,
            })
            .collect())
    }

    async fn apps(&self, user: &MacroUserIdStr<'static>) -> anyhow::Result<Vec<String>> {
        self.apps.connected_app_slugs(user).await
    }
}
