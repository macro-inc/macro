//! The agent composer's Auto mode: whether a prompt goes to a chat agent or a
//! coding agent, decided by a fast yes/no classifier before the session starts.

use std::{sync::Arc, time::Duration};

use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageContext};
use feature_flags::FeatureFlags;
use jev::domain::{JevError, YesNoClassifier, YesNoQuestion};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;
use tracing::Instrument;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// The composer waits on this before starting a session, so a slow classifier
/// falls back to Chat instead of holding the send.
const DECISION_TIMEOUT: Duration = Duration::from_secs(3);
/// Leading characters of the prompt the classifier reads. What a request is
/// asking for shows up early; the rest only adds latency and cost.
const MAX_PROMPT_CHARS: usize = 4_000;
/// PostHog flag gating Auto mode; the web composer reads the same key.
pub const AUTO_MODE_FLAG: &str = "enable-composer-auto-mode";
/// Probability of yes at or above which a prompt goes to a coding agent.
const CODE_THRESHOLD: f32 = 0.5;
const NEEDS_CODING_AGENT: &str = "Does this request need a coding agent working in a software \
repository: building, changing, debugging, testing, or reviewing code? Answer no for questions, \
explanations, writing, research, documents, email, calendar, or other work a chat assistant can \
do without a repository.";

/// Which kind of agent a prompt is sent to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    /// A chat agent, such as Macro.
    Chat,
    /// A coding agent with a repository.
    Code,
}

/// Why Auto mode could not decide; the composer falls back to Chat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ModeChoiceError {
    /// The prompt has no text.
    #[error("a prompt needs text")]
    EmptyPrompt,
    /// Auto mode is not enabled for this user, or their flags could not be read.
    #[error("automatic mode choice is not enabled")]
    NotEnabled,
    /// No classifier is configured on this deployment.
    #[error("automatic mode choice is not configured")]
    Unavailable,
    /// The user cannot start new AI work.
    #[error(transparent)]
    Admission(#[from] AiAdmissionError),
    /// The classifier did not answer within the composer's deadline.
    #[error("automatic mode choice timed out")]
    Timeout,
    /// The classifier failed or answered unusably.
    #[error(transparent)]
    Classifier(#[from] JevError),
}

/// Decides Chat or Code for a prompt sent from the composer's Auto mode.
/// Object-safe so the composition root can hand the router an `Arc<dyn ...>`.
#[async_trait::async_trait]
pub trait ModeChoiceService: Send + Sync + 'static {
    /// Choose for the authenticated `owner`, who is billed for any usage.
    async fn choose(
        &self,
        owner: MacroUserIdStr<'static>,
        prompt: &str,
    ) -> Result<AgentMode, ModeChoiceError>;
}

/// [`ModeChoiceService`] over a metered yes/no classifier, for users with
/// [`AUTO_MODE_FLAG`].
pub struct ModeChoiceServiceImpl<C, F> {
    classifier: Option<Arc<C>>,
    flags: Option<F>,
    admission: Arc<dyn AiAdmissionService>,
}

impl<C: YesNoClassifier, F: FeatureFlags + 'static> ModeChoiceServiceImpl<C, F> {
    /// Without a classifier every choice fails as [`ModeChoiceError::Unavailable`];
    /// without flags, as [`ModeChoiceError::NotEnabled`].
    pub fn new(
        classifier: Option<C>,
        flags: Option<F>,
        admission: Arc<dyn AiAdmissionService>,
    ) -> Self {
        Self {
            classifier: classifier.map(Arc::new),
            flags,
            admission,
        }
    }

    async fn enabled(&self, owner: &MacroUserIdStr<'_>) -> bool {
        let Some(flags) = &self.flags else {
            return false;
        };
        flags
            .load(owner)
            .await
            .inspect_err(|error| {
                tracing::warn!(?error, "feature flags unavailable; Auto mode stays off");
            })
            .is_ok_and(|flags| flags.is_enabled(AUTO_MODE_FLAG))
    }
}

#[async_trait::async_trait]
impl<C: YesNoClassifier, F: FeatureFlags + 'static> ModeChoiceService
    for ModeChoiceServiceImpl<C, F>
{
    #[tracing::instrument(
        name = "agent.mode_choice",
        skip_all,
        err,
        fields(
            agent.mode_choice.prompt_chars = prompt.chars().count(),
            agent.mode_choice.probability = tracing::field::Empty,
            agent.mode_choice.outcome = tracing::field::Empty,
        )
    )]
    async fn choose(
        &self,
        owner: MacroUserIdStr<'static>,
        prompt: &str,
    ) -> Result<AgentMode, ModeChoiceError> {
        let prompt = prompt.trim();
        if prompt.is_empty() {
            return Err(ModeChoiceError::EmptyPrompt);
        }
        let classifier = self
            .classifier
            .clone()
            .ok_or(ModeChoiceError::Unavailable)?;
        let (enabled, admitted) = tokio::join!(
            self.enabled(&owner),
            self.admission.admit(&owner, AiFeature::AgentModeChoice)
        );
        if !enabled {
            return Err(ModeChoiceError::NotEnabled);
        }
        admitted?;
        let input = serde_json::Value::String(prompt.chars().take(MAX_PROMPT_CHARS).collect());
        let question = YesNoQuestion::try_from(NEEDS_CODING_AGENT)
            .expect("the coding question is nonblank and under the length limit");
        // A timed-out caller detaches the task, which still records the usage
        // the provider bills for.
        let task = tokio::spawn(
            async move {
                classifier
                    .classify(
                        UsageContext::new(AiFeature::AgentModeChoice, owner),
                        &input,
                        &[question],
                    )
                    .await
            }
            .instrument(tracing::Span::current()),
        );
        let probabilities = tokio::time::timeout(DECISION_TIMEOUT, task)
            .await
            .map_err(|_| ModeChoiceError::Timeout)?
            .map_err(|_| ModeChoiceError::Classifier(JevError::Unavailable))??;
        let probability = probabilities
            .first()
            .ok_or(ModeChoiceError::Classifier(JevError::InvalidResponse))?
            .get();
        let mode = if probability >= CODE_THRESHOLD {
            AgentMode::Code
        } else {
            AgentMode::Chat
        };
        let span = tracing::Span::current();
        span.record("agent.mode_choice.probability", probability);
        span.record("agent.mode_choice.outcome", tracing::field::debug(mode));
        Ok(mode)
    }
}
