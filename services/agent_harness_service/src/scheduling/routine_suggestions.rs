//! Where routine suggestions read the person's accounts from, and the model
//! call that finds the work in their mail.

use std::sync::Arc;

use agent::structured_output::{CompletionThinking, DynamicSchema};
use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use crm::domain::auth::CrmMemberAccess;
use email_service_client::EmailServiceClient;
use email_service_client::get_recent_inbox_messages::{InboxWindow, RecentMailFolder};
use entity_access::domain::ports::AccessRepository;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::message::{
    RecentInboxMessage, RecentInboxMessagesResponse, UnreadableMailboxReason,
};
use scheduled_action::domain::suggestions::ports::{InboxMessage, SuggestionSources, WorkModel};
use uuid::Uuid;

use crate::routine_sessions::RoutineConnectedApps;
use connectors::{ConnectionManagementService, McpConnectionsService};

/// Snippet length suggestions read: past the provider's preview, from the
/// body.
const SNIPPET_CHARS: u16 = 500;

/// The newest mail through email_service, which reads it from Gmail and
/// Outlook, the apps the person has connected, and their
/// team and its CRM access through their crates' ports.
pub struct HarnessSuggestionSources<S, Teams, Crm> {
    pub email: Arc<EmailServiceClient>,
    pub apps: RoutineConnectedApps<S>,
    pub teams: Teams,
    pub crm: Crm,
}

impl<S, Teams, Crm> SuggestionSources for HarnessSuggestionSources<S, Teams, Crm>
where
    S: McpConnectionsService + ConnectionManagementService,
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
        Ok(inbox_messages(response))
    }

    async fn inbox_window(
        &self,
        user: &MacroUserIdStr<'static>,
        days: u16,
        limit: u16,
        texts: u16,
    ) -> anyhow::Result<Vec<InboxMessage>> {
        self.window(user, RecentMailFolder::Inbox, days, limit, texts)
            .await
    }

    async fn sent_window(
        &self,
        user: &MacroUserIdStr<'static>,
        days: u16,
        limit: u16,
        texts: u16,
    ) -> anyhow::Result<Vec<InboxMessage>> {
        self.window(user, RecentMailFolder::Sent, days, limit, texts)
            .await
    }

    async fn apps(&self, user: &MacroUserIdStr<'static>) -> anyhow::Result<Vec<String>> {
        self.apps.connected_app_slugs(user).await
    }

    async fn crm(&self, user: &MacroUserIdStr<'static>) -> anyhow::Result<bool> {
        team_crm_access(&self.teams, &self.crm, user).await
    }
}

impl<S, Teams, Crm> HarnessSuggestionSources<S, Teams, Crm> {
    /// The person's mail in `folder` over the last `days` days.
    async fn window(
        &self,
        user: &MacroUserIdStr<'static>,
        folder: RecentMailFolder,
        days: u16,
        limit: u16,
        texts: u16,
    ) -> anyhow::Result<Vec<InboxMessage>> {
        let window = InboxWindow {
            folder,
            days,
            limit,
            texts,
            snippet_chars: SNIPPET_CHARS,
        };
        let response = self.email.get_inbox_window(user.as_ref(), window).await?;
        Ok(inbox_messages(response))
    }
}

/// Preserve best-effort messages while recording why their context is partial.
#[tracing::instrument(
    name = "routine_suggestions.mail_context",
    skip_all,
    fields(
        unreadable_mailbox_count,
        unsupported_mailbox_count,
        provider_error_mailbox_count
    )
)]
fn inbox_messages(response: RecentInboxMessagesResponse) -> Vec<InboxMessage> {
    let mut unsupported = 0i64;
    let mut provider_error = 0i64;
    for mailbox in &response.unreadable_mailboxes {
        match mailbox.reason {
            UnreadableMailboxReason::Unsupported => unsupported += 1,
            UnreadableMailboxReason::ProviderError => provider_error += 1,
        }
    }
    let span = tracing::Span::current();
    span.record("unreadable_mailbox_count", unsupported + provider_error);
    span.record("unsupported_mailbox_count", unsupported);
    span.record("provider_error_mailbox_count", provider_error);
    if provider_error > 0 {
        tracing::warn!(
            reason = ?UnreadableMailboxReason::ProviderError,
            count = provider_error,
            "routine suggestions use partial recent-mail context"
        );
    }
    response.messages.into_iter().map(inbox_message).collect()
}

fn inbox_message(message: RecentInboxMessage) -> InboxMessage {
    InboxMessage {
        from: message.from.map(|from| match from.name {
            Some(name) if !name.trim().is_empty() => format!("{name} <{}>", from.email),
            _ => from.email,
        }),
        to: message.to,
        subject: message.subject,
        labels: message.labels,
        snippet: message.snippet,
        received_at: message.received_at,
    }
}

/// What the finding call is, before its instructions and the mail.
const WORK_SYSTEM: &str = "You read one person's mail and list the work in it.";

/// The finding call on the model router, recorded as the generation
/// session's own usage, never billed.
pub struct RouterWorkModel {
    pub recorder: Arc<dyn UsageRecorder>,
}

// Object-safe (`async_trait`): the service holds it as `Arc<dyn WorkModel>`.
#[async_trait::async_trait]
impl WorkModel for RouterWorkModel {
    async fn complete(
        &self,
        user: &MacroUserIdStr<'static>,
        session: Uuid,
        model: &str,
        prompt: String,
        schema: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        agent::structured_output::dynamic_structured_completion_thinking(
            model,
            WORK_SYSTEM,
            vec![agent::Message::user(prompt)],
            DynamicSchema {
                schema,
                name: "work_list".to_owned(),
                description: None,
            },
            CompletionThinking::Low,
            self.recorder.as_ref(),
            UsageContext {
                agent_session_id: Some(session),
                ..UsageContext::new(AiFeature::NonBillableAgentSession, user.clone())
            },
        )
        .await
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
