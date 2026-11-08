//! Where routine suggestions read the person's accounts from, and the
//! model that picks them.

use std::sync::Arc;

use agent::structured_output::{CompletionThinking, DynamicSchema};
use ai_usage::AiFeature;
use email_service_client::EmailServiceClient;
use macro_user_id::user_id::MacroUserIdStr;
use scheduled_action::domain::suggestions::ports::{
    InboxMessage, SuggestionModel, SuggestionSources,
};
use serde_json::Value;

use agent_harness_service::cognition::{
    ToolFreeCompletion, ToolFreeCompletionService, ToolFreeRequest,
};

/// The free tier's model, which every plan may use, thinking briefly. Its
/// usage is recorded as the non-billable `RoutineSuggestions`: suggestions
/// are picked in the background without the person asking.
pub struct ModelSuggestions {
    completions: ToolFreeCompletionService,
}

impl ModelSuggestions {
    pub fn new(recorder: Arc<dyn ai_usage::UsageRecorder>) -> Self {
        Self {
            completions: ToolFreeCompletionService::new(recorder)
                .for_feature(AiFeature::RoutineSuggestions),
        }
    }
}

impl SuggestionModel for ModelSuggestions {
    async fn complete(
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
                        description: Some(
                            "Catalog routines and requests picked for this person.".to_owned(),
                        ),
                        schema: schema.clone(),
                    },
                    thinking: CompletionThinking::Low,
                },
            )
            .await
            .inspect_err(
                |error| tracing::warn!(error = %error, "routine suggestion completion failed"),
            )
            .ok()
    }
}

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

    /// Detected tools arrive with onboarding's tool suggestions; until then
    /// a generation reads none.
    async fn tools(&self, _: &MacroUserIdStr<'static>) -> anyhow::Result<Vec<String>> {
        Ok(Vec::new())
    }
}
