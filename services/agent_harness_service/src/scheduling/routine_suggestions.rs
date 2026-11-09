//! Where routine suggestions read the person's accounts from, and the
//! model the fast first wave picks catalog routines with.

use std::sync::Arc;

use agent::structured_output::{CompletionThinking, DynamicSchema};
use agent_harness_service::cognition::{
    ToolFreeCompletion, ToolFreeCompletionService, ToolFreeRequest,
};
use agent_session::domain::routines::ConnectedApps;
use ai_usage::AiFeature;
use email_service_client::EmailServiceClient;
use macro_user_id::user_id::MacroUserIdStr;
use scheduled_action::domain::suggestions::ports::{InboxMessage, QuickPicks, SuggestionSources};
use serde_json::Value;

/// The free tier's model, which every plan may use, thinking briefly. Its
/// usage is recorded as the non-billable `RoutineSuggestions`: suggestions
/// are picked in the background without the person asking.
pub struct ModelQuickPicks {
    completions: ToolFreeCompletionService,
}

impl ModelQuickPicks {
    pub fn new(recorder: Arc<dyn ai_usage::UsageRecorder>) -> Self {
        Self {
            completions: ToolFreeCompletionService::new(recorder)
                .for_feature(AiFeature::RoutineSuggestions),
        }
    }
}

#[async_trait::async_trait]
impl QuickPicks for ModelQuickPicks {
    async fn pick(
        &self,
        user: &MacroUserIdStr<'static>,
        instructions: &str,
        prompt: &str,
        schema: &Value,
    ) -> Option<Value> {
        self.completions
            .complete(
                user.clone(),
                ToolFreeRequest {
                    model: chat::domain::models::FREE_MODEL.to_owned(),
                    system_prompt: instructions.to_owned(),
                    prompt: prompt.to_owned(),
                    schema: DynamicSchema {
                        name: "RoutineSuggestions".to_owned(),
                        description: Some("Catalog routines picked for this person.".to_owned()),
                        schema: schema.clone(),
                    },
                    thinking: CompletionThinking::Low,
                },
            )
            .await
            .inspect_err(
                |error| tracing::warn!(error = %error, "routine suggestion first wave failed"),
            )
            .ok()
    }
}

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
