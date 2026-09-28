//! Implicit-trigger judgement backed by the fast agent model.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use agent_session::domain::error::Result;
use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use messages::domain::events::MessagePostedMetadata;
use serde::Deserialize;
use serde_json::json;

use crate::domain::service::ImplicitTriggerJudge;

use super::image_caption::{ImageCaptioner, append_image_blurbs, blurbs_for_attachments};

static SYSTEM_PROMPT: &str = "\
You decide whether a channel message is addressed to an AI coding agent.

The message was posted, without mentioning anyone, in a thread where an AI \
coding agent has an open session: the agent was asked to do work earlier in \
the thread and posts its progress there. Decide whether this new message is \
directed at that agent - a follow-up instruction, question, correction, or \
feedback the agent should act on - or is conversation between the people in \
the thread.

Return true only when the message reads as something its author expects the \
agent to respond to. Return false when it is commentary about the agent or \
its work addressed to other people, or unrelated discussion.

You are given the thread around the agent's part in it, as lines of \
'[speaker] message' where the agent's own messages are marked '[agent]'. Some \
messages may be hidden; judge on what you are shown.

Attached images are not shown to you. Each one is written into the message \
as <this is an image of ...>, a description of the picture rather than words \
the author typed. Treat that description as what the image shows. \
<this is an image> means a picture was attached but could not be described. \
Those descriptions appear on the message to judge; the thread transcript \
does not repeat them.";

#[derive(Debug, Deserialize)]
struct JudgeOutput {
    addressed_to_agent: bool,
    #[expect(dead_code, reason = "the model reasons better when asked to explain")]
    reason: String,
}

/// Judges implicit triggers with [`PredefinedModel::Fast`], recording token
/// usage against the message's sender.
pub struct FastModelTriggerJudge {
    model: PredefinedModel,
    recorder: Arc<dyn UsageRecorder>,
    images: Arc<dyn ImageCaptioner>,
}

impl FastModelTriggerJudge {
    /// Creates a judge using the fast agent model.
    ///
    /// `images` turns attached pictures into the `<this is an image of ...>`
    /// blurbs the text-only model reads. The forwarded message is unchanged.
    pub fn new(recorder: Arc<dyn UsageRecorder>, images: impl ImageCaptioner + 'static) -> Self {
        Self {
            model: PredefinedModel::Fast,
            recorder,
            images: Arc::new(images),
        }
    }
}

impl ImplicitTriggerJudge for FastModelTriggerJudge {
    async fn is_addressed_to_agent(
        &self,
        posted: &MessagePostedMetadata,
        transcript: &str,
    ) -> Result<bool> {
        let schema = DynamicSchema {
            name: "ImplicitTriggerJudgeOutput".to_string(),
            description: Some(
                "Judgement for whether a thread message is addressed to the agent.".to_string(),
            ),
            schema: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["addressed_to_agent", "reason"],
                "properties": {
                    "addressed_to_agent": {
                        "type": "boolean",
                        "description": "True only if the message is directed at the agent."
                    },
                    "reason": {
                        "type": "string",
                        "description": "A concise reason for the judgement."
                    }
                }
            }),
        };
        // The judge runs on behalf of whoever posted the message, so their
        // account carries the tokens; a non-user sender never reaches this
        // point, but attribute it to the system rather than fail if one does.
        let ctx = match posted.sender.as_user() {
            Some(user) => UsageContext::new(AiFeature::Automation, user.clone()),
            None => UsageContext::system(AiFeature::Automation),
        };

        let blurbs =
            blurbs_for_attachments(self.images.as_ref(), &posted.attachments, ctx.clone()).await;
        let content = append_image_blurbs(&posted.content, &blurbs);
        let prompt = judge_user_prompt(transcript, &content);

        let value = dynamic_structured_completion(
            self.model,
            SYSTEM_PROMPT,
            vec![Message::user(prompt)],
            schema,
            self.recorder.as_ref(),
            ctx,
        )
        .await?;

        let output: JudgeOutput = serde_json::from_value(value).map_err(|error| {
            anyhow::anyhow!("implicit trigger judge returned malformed output: {error}")
        })?;
        Ok(output.addressed_to_agent)
    }
}

/// The user prompt the judge scores. Image blurbs are already part of `content`.
pub(crate) fn judge_user_prompt(transcript: &str, content: &str) -> String {
    if transcript.is_empty() {
        format!("The message to judge:\n{content}")
    } else {
        format!("The thread so far:\n{transcript}\nThe message to judge:\n{content}")
    }
}
