//! Optional naming is independently admitted, never a prerequisite for runtime execution.

use std::sync::Arc;

use ai_billing::{AiAdmissionService, AiFeature};
use ai_usage::UsageContext;
use jev::domain::{JevError, YesNoClassifier, YesNoQuestion};

use super::{model::AgentSession, ports::AgentSessionNameGenerator, retitle::ConversationDigest};

#[cfg(test)]
mod test;

/// Probability of yes at or above which a session is retitled. High on
/// purpose: a name that changes under a reader is worse than one that is a
/// little vague, so only a name that has clearly stopped fitting is replaced.
const RETITLE_THRESHOLD: f32 = 0.8;
const TITLE_NO_LONGER_FITS: &str = "The input is an AI agent session's current title and its \
conversation so far. Would someone scanning a list of sessions fail to recognize this \
conversation from its title, because the title is generic (like \"Investigate Issue\" or \
\"Review Comment\") or names a different topic than the conversation is now about? Answer no \
when the title already names the conversation's specific subject.";

/// Admits Macro-funded naming while leaving the existing session name on refusal.
#[derive(Clone)]
pub struct AdmittedAgentSessionNameGenerator<N> {
    generator: N,
    admission: Arc<dyn AiAdmissionService>,
}

impl<N> AdmittedAgentSessionNameGenerator<N> {
    /// Wrap a name generator with the host's configured admission service.
    pub fn new(generator: N, admission: Arc<dyn AiAdmissionService>) -> Self {
        Self {
            generator,
            admission,
        }
    }

    /// Whether the session's owner may spend on naming. Naming must not
    /// invent a billing identity for a non-user owner.
    async fn admitted(&self, session: &AgentSession) -> bool {
        let Ok(owner) = session.owner_user() else {
            return false;
        };
        self.admission
            .admit(owner, AiFeature::ChatRename)
            .await
            .inspect_err(|error| {
                tracing::debug!(code = error.code(), "skipping optional session naming");
            })
            .is_ok()
    }
}

impl<N: AgentSessionNameGenerator> AgentSessionNameGenerator
    for AdmittedAgentSessionNameGenerator<N>
{
    async fn generate_name(
        &self,
        session: &AgentSession,
        initial_prompt: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        if !self.admitted(session).await {
            return Ok(None);
        }
        self.generator.generate_name(session, initial_prompt).await
    }

    async fn retitle(
        &self,
        session: &AgentSession,
        current: &str,
        conversation: &ConversationDigest,
    ) -> Result<Option<String>, rootcause::Report> {
        if !self.admitted(session).await {
            return Ok(None);
        }
        self.generator.retitle(session, current, conversation).await
    }
}

/// Retitles only when a fast yes/no classifier judges the current name no
/// longer fits, so the wrapped generator's model runs rarely. Without a
/// classifier every name is kept.
pub struct ClassifiedRetitle<N, C> {
    generator: N,
    classifier: Option<Arc<C>>,
}

impl<N, C> ClassifiedRetitle<N, C> {
    /// Gate `generator`'s retitling on `classifier`.
    pub fn new(generator: N, classifier: Option<C>) -> Self {
        Self {
            generator,
            classifier: classifier.map(Arc::new),
        }
    }
}

impl<N: Clone, C> Clone for ClassifiedRetitle<N, C> {
    fn clone(&self) -> Self {
        Self {
            generator: self.generator.clone(),
            classifier: self.classifier.clone(),
        }
    }
}

impl<N: AgentSessionNameGenerator, C: YesNoClassifier> AgentSessionNameGenerator
    for ClassifiedRetitle<N, C>
{
    async fn generate_name(
        &self,
        session: &AgentSession,
        initial_prompt: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        self.generator.generate_name(session, initial_prompt).await
    }

    #[tracing::instrument(
        name = "agent.session.retitle.decide",
        skip_all,
        err,
        fields(
            agent.session.id = %session.id,
            agent.retitle.messages = conversation.messages.len(),
            agent.retitle.probability = tracing::field::Empty,
        )
    )]
    async fn retitle(
        &self,
        session: &AgentSession,
        current: &str,
        conversation: &ConversationDigest,
    ) -> Result<Option<String>, rootcause::Report> {
        let Some(classifier) = &self.classifier else {
            return Ok(None);
        };
        // Usage is billed to a person; anything else keeps its name.
        let Ok(owner) = session.owner_user() else {
            return Ok(None);
        };
        let input = serde_json::json!({
            "current_title": current,
            "conversation": conversation,
        });
        let question = YesNoQuestion::try_from(TITLE_NO_LONGER_FITS)
            .expect("the retitle question is nonblank and under the length limit");
        let usage = UsageContext::new(AiFeature::ChatRename, owner.clone())
            .with_entity(Some(session.id.as_uuid()));
        let probability = classifier
            .classify(usage, &input, &[question])
            .await
            .map_err(|error| rootcause::report!(error))?
            .first()
            .ok_or_else(|| rootcause::report!(JevError::InvalidResponse))?
            .get();
        tracing::Span::current().record("agent.retitle.probability", probability);
        if probability < RETITLE_THRESHOLD {
            return Ok(None);
        }
        self.generator.retitle(session, current, conversation).await
    }
}
