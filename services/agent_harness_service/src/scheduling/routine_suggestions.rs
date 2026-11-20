//! Where routine suggestions read the person's accounts from.

use std::sync::Arc;

use agent_session::domain::routines::ConnectedApps;
use crm::domain::auth::CrmMemberAccess;
use email_service_client::EmailServiceClient;
use entity_access::domain::ports::AccessRepository;
use macro_user_id::user_id::MacroUserIdStr;
use scheduled_action::domain::suggestions::ports::{InboxMessage, SuggestionSources};

use crate::routine_sessions::PipedreamConnectedApps;

/// Snippet length suggestions read: past the provider's preview, from the
/// body.
const SNIPPET_CHARS: u16 = 500;

/// The newest mail through email_service, which reads it from Gmail and
/// Outlook, the apps the person connected through Pipedream, and their
/// team and its CRM access through their crates' ports.
pub struct HarnessSuggestionSources<Connections, Connect, Teams, Crm> {
    pub email: Arc<EmailServiceClient>,
    pub apps: PipedreamConnectedApps<Connections, Connect>,
    pub teams: Teams,
    pub crm: Crm,
}

impl<Connections, Connect, Teams, Crm> SuggestionSources
    for HarnessSuggestionSources<Connections, Connect, Teams, Crm>
where
    Connections: pipedream_mcp::domain::ports::ConnectionStore,
    Connect: pipedream_mcp::domain::ports::MacroConnect,
    Teams: AccessRepository,
    Crm: CrmMemberAccess + 'static,
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

    async fn crm(&self, user: &MacroUserIdStr<'static>) -> anyhow::Result<bool> {
        team_crm_access(&self.teams, &self.crm, user).await
    }
}

/// The check CRM's company tools make before adding one: the person is in a
/// team, and its CRM is open to them.
async fn team_crm_access(
    teams: &impl AccessRepository,
    crm: &impl CrmMemberAccess,
    user: &MacroUserIdStr<'_>,
) -> anyhow::Result<bool> {
    let Some(team) = teams.get_user_team(&user.0).await? else {
        return Ok(false);
    };
    Ok(crm
        .member_has_crm_access(team.team_id, user.as_ref())
        .await?)
}

#[cfg(test)]
mod test;
