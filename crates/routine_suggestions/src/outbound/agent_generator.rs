//! [`SuggestionGenerator`] over a prompted structured completion.

use std::sync::Arc;

use agent::Message;
use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::SuggestionGenerator;

/// The completion failed or did not match the schema.
#[derive(Debug, thiserror::Error)]
#[error("routine suggestion completion failed: {0}")]
pub struct CompletionError(String);

/// Answers with one structured completion on a fixed model, metered to the
/// user as routine suggestions.
pub struct AgentSuggestionGenerator {
    model: String,
    recorder: Arc<dyn UsageRecorder>,
}

impl AgentSuggestionGenerator {
    /// Builds the generator on `model` (a routing id such as the free-tier
    /// model), recording usage through `recorder`.
    pub fn new(model: impl Into<String>, recorder: Arc<dyn UsageRecorder>) -> Self {
        Self {
            model: model.into(),
            recorder,
        }
    }
}

impl SuggestionGenerator for AgentSuggestionGenerator {
    type Err = CompletionError;

    #[tracing::instrument(skip_all, fields(model = %self.model), err)]
    async fn generate(
        &self,
        user: &MacroUserIdStr<'static>,
        system_prompt: &str,
        user_prompt: String,
        schema: serde_json::Value,
    ) -> Result<serde_json::Value, Self::Err> {
        dynamic_structured_completion(
            &self.model,
            system_prompt,
            vec![Message::user(user_prompt)],
            DynamicSchema {
                schema,
                name: "RoutineSuggestions".to_owned(),
                description: None,
            },
            self.recorder.as_ref(),
            UsageContext::new(AiFeature::RoutineSuggestions, user.clone()),
        )
        .await
        .map_err(|error| CompletionError(format!("{error:#}")))
    }
}
