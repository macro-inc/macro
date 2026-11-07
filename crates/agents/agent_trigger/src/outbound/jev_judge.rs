//! Implicit-trigger judgement backed by the Jev yes/no classifier.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_session::domain::error::Result;
use ai_usage::{AiFeature, UsageContext};
use jev::domain::{YesNoClassifier, YesNoQuestion};
use messages::domain::events::MessagePostedMetadata;
use serde_json::{Value, json};

use crate::domain::service::ImplicitTriggerJudge;

use super::image_caption::{ImageCaptioner, append_image_blurbs, blurbs_for_attachments};

/// What the classifier is looking at, sent alongside the thread and message.
const SITUATION: &str = "\
A message was posted, without @-mentioning anyone, in a channel thread where AI \
agents have open sessions: each was asked to do work earlier in the thread and \
posts its progress there. People in a thread mostly talk to each other; an agent \
should answer only messages meant for it. `thread` is the conversation around the \
agents' part in it, as lines of '[speaker] message'. People are named; each agent \
is labelled 'agent N (its name)', and other bots 'bot (its name)'. Some messages \
may be hidden. `author` is who posted the new message, and `message` is the new \
message. Attached images are not shown: each is written into the message as \
<this is an image of ...>, a description of the picture rather than words the \
author typed, or <this is an image> when it could not be described.";

/// Judges implicit triggers with Jev, one yes/no question per live agent,
/// metering usage against the user the message invokes for.
pub struct JevTriggerJudge<C> {
    classifier: Arc<C>,
    images: Arc<dyn ImageCaptioner>,
}

impl<C: YesNoClassifier> JevTriggerJudge<C> {
    /// Creates a judge asking `classifier`.
    ///
    /// `images` turns attached pictures into the `<this is an image of ...>`
    /// blurbs the text-only classifier reads. The forwarded message is
    /// unchanged.
    pub fn new(classifier: Arc<C>, images: impl ImageCaptioner + 'static) -> Self {
        Self {
            classifier,
            images: Arc::new(images),
        }
    }
}

impl<C: YesNoClassifier> ImplicitTriggerJudge for JevTriggerJudge<C> {
    async fn addressee_probabilities(
        &self,
        posted: &MessagePostedMetadata,
        transcript: &str,
        author: &str,
        agents: usize,
    ) -> Result<Vec<f32>> {
        let Some(user) = posted.invoking_user() else {
            return Ok(vec![0.0; agents]);
        };
        let ctx = UsageContext::new(AiFeature::Automation, user);

        let blurbs =
            blurbs_for_attachments(self.images.as_ref(), &posted.attachments, ctx.clone()).await;
        let content = append_image_blurbs(&posted.content, &blurbs);
        let questions = addressee_questions(agents)?;

        let probabilities = self
            .classifier
            .classify(ctx, &judge_input(transcript, author, &content), &questions)
            .await
            .map_err(|error| anyhow::anyhow!("implicit trigger judge failed: {error}"))?;
        Ok(probabilities
            .into_iter()
            .map(|probability| probability.get())
            .collect())
    }
}

/// The JSON the classifier reads. Image blurbs are already part of `content`.
pub(crate) fn judge_input(transcript: &str, author: &str, content: &str) -> Value {
    json!({
        "situation": SITUATION,
        "thread": transcript,
        "author": author,
        "message": content,
    })
}

/// One question per agent, asking whether `message` is meant for it.
///
/// Leans to "no": an agent answering a message meant for a person is worse
/// than one waiting to be named. Naming the agent, answering its question, or
/// redirecting its work with nobody else taking it on are the yes cases.
pub(crate) fn addressee_questions(agents: usize) -> Result<Vec<YesNoQuestion>> {
    (1..=agents)
        .map(|agent| {
            YesNoQuestion::try_from(format!(
                "Is `message` meant for agent {agent} to act on or answer? Yes only if it \
                 calls agent {agent} by name, answers a question agent {agent} just asked, \
                 or gives agent {agent} an instruction, correction, or feedback that no \
                 person in the thread is taking on. No if it names or answers a person, is \
                 people talking among themselves (even agreeing on a plan), talks about an \
                 agent to others, or is unclear."
            ))
            .map_err(|error| anyhow::anyhow!("invalid addressee question: {error}").into())
        })
        .collect()
}
