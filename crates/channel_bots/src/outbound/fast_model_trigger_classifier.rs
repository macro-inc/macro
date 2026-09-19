//! Fast-model adapter for inferred trigger classification.

use std::fmt::Write as _;
use std::sync::Arc;

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use serde_json::json;

use crate::domain::models::TranscriptMessage;
use crate::domain::ports::InferredTriggerClassifier;

static SYSTEM_PROMPT: &str = r#"You decide whether the latest message in a channel thread expects a response from Macro, an AI agent participating in the thread. The agent normally only responds when explicitly @-mentioned; your job is to catch messages that are clearly directed at the agent without a mention.

Answer true only when the latest message is addressed to the agent, for example:
- it asks the agent a question or gives it an instruction
- it answers a question the agent just asked
- it reacts to the agent's last message in a way that invites a reply (a correction, a complaint about the agent's answer, a follow-up)

Answer false when:
- the message is addressed to another person in the thread
- the message is general discussion between people that the agent happens to be able to see
- the message closes the conversation and invites no reply (e.g. "thanks", "got it")
- it is ambiguous who the message is addressed to

When in doubt, answer false: an unwanted agent reply is worse than a missed one."#;

/// [`InferredTriggerClassifier`] backed by a one-shot completion on the fast
/// model.
pub struct FastModelTriggerClassifier {
    model: PredefinedModel,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
}

#[derive(Debug, Deserialize)]
struct ClassifierOutput {
    expects_response: bool,
    reason: String,
}

impl FastModelTriggerClassifier {
    /// Create a classifier using the fast agent model.
    pub fn new(recorder: Arc<dyn ai_usage::UsageRecorder>) -> Self {
        Self {
            model: PredefinedModel::Fast,
            recorder,
        }
    }
}

fn render_thread(thread: &[TranscriptMessage]) -> String {
    let mut rendered = String::new();
    for message in thread {
        let role = if message.from_agent {
            " (the agent)"
        } else {
            ""
        };
        let _ = writeln!(rendered, "{}{role}: {}", message.sender, message.content);
    }
    rendered
}

#[async_trait]
impl InferredTriggerClassifier for FastModelTriggerClassifier {
    #[tracing::instrument(skip(self, thread), err)]
    async fn expects_response(
        &self,
        requesting_user: &MacroUserIdStr<'static>,
        thread: &[TranscriptMessage],
    ) -> anyhow::Result<bool> {
        let prompt = format!(
            "Thread (oldest to newest; the last message is the one to judge):\n\n{}",
            render_thread(thread)
        );
        let schema = DynamicSchema {
            name: "InferredTriggerOutput".to_string(),
            description: Some(
                "Judgement for whether the latest thread message expects an agent response."
                    .to_string(),
            ),
            schema: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["expects_response", "reason"],
                "properties": {
                    "expects_response": {
                        "type": "boolean",
                        "description": "True only if the latest message is addressed to the agent and expects it to respond."
                    },
                    "reason": {
                        "type": "string",
                        "description": "A concise reason for the judgement."
                    }
                }
            }),
        };

        let value = dynamic_structured_completion(
            self.model,
            SYSTEM_PROMPT,
            vec![Message::user(prompt)],
            schema,
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::ChannelBot, requesting_user.clone()),
        )
        .await?;

        let output: ClassifierOutput = serde_json::from_value(value)?;
        tracing::debug!(
            expects_response = output.expects_response,
            reason = %output.reason,
            "inferred trigger classification"
        );
        Ok(output.expects_response)
    }
}
