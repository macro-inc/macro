//! The model that drafts routines from people's words, for the scheduler's
//! drafter.

use std::sync::Arc;

use agent::structured_output::{CompletionThinking, DynamicSchema};
use agent_harness_service::cognition::{
    ToolFreeCompletion, ToolFreeCompletionService, ToolFreeRequest,
};
use ai_usage::AiFeature;
use macro_user_id::user_id::MacroUserIdStr;
use scheduled_action::domain::ports::{DraftCompletion, DraftModel};
use serde_json::Value;

/// Drafts on the free tier's model, which every plan may use, thinking
/// briefly: the type checker corrects a quick answer faster than the model
/// can think one through. Usage is billed to the person as automation work.
pub struct ModelDrafts {
    completions: ToolFreeCompletionService,
}

impl ModelDrafts {
    pub fn new(recorder: Arc<dyn ai_usage::UsageRecorder>) -> Self {
        Self {
            completions: ToolFreeCompletionService::new(recorder)
                .for_feature(AiFeature::Automation),
        }
    }
}

impl DraftModel for ModelDrafts {
    async fn complete(
        &self,
        owner: &MacroUserIdStr<'static>,
        completion: DraftCompletion<'_>,
    ) -> Option<Value> {
        self.completions
            .complete(
                owner.clone(),
                ToolFreeRequest {
                    model: chat::domain::models::FREE_MODEL.to_owned(),
                    system_prompt: completion.instructions.to_owned(),
                    prompt: completion.prompt.to_owned(),
                    schema: DynamicSchema {
                        name: completion.schema.name.to_owned(),
                        description: Some(completion.schema.description.to_owned()),
                        schema: completion.schema.schema.clone(),
                    },
                    thinking: CompletionThinking::Low,
                },
            )
            .await
            .inspect_err(|error| tracing::warn!(error = %error, "routine draft completion failed"))
            .ok()
    }
}
