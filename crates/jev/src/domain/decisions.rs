//! Bounded, admitted named decisions for a trusted originating user.

use super::{
    DecisionRequest, DecisionResponse, DecisionValidationError, JevError, YesNoClassifier,
};
use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageContext};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use std::{sync::Arc, time::Duration};
use tokio::{sync::Semaphore, time::Instant};
use tracing::Instrument;

#[cfg(test)]
mod test;

const MAX_CONCURRENT_DECISIONS: usize = 16;
const DECISION_TIMEOUT: Duration = Duration::from_secs(28);

/// Sanitized failures of a named decision operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DecisionError {
    /// The request violates the named decision bounds.
    #[error(transparent)]
    InvalidRequest(#[from] DecisionValidationError),
    /// The originating user cannot start new AI work.
    #[error(transparent)]
    Admission(#[from] AiAdmissionError),
    /// No decision provider is configured.
    #[error("decisions are temporarily unavailable")]
    Unavailable,
    /// All decision capacity is occupied; no new provider work was started.
    #[error("decisions are busy; retry later")]
    Busy,
    /// The total admission and classification deadline elapsed.
    #[error("the decision request timed out")]
    Timeout,
    /// Classification did not yield a usable result.
    #[error(transparent)]
    Provider(#[from] JevError),
    /// The admitted task failed unexpectedly.
    #[error("the decision request could not complete")]
    Failed,
}

/// General named decisions, independent of an agent, session, or execution.
/// Uses object-safe async dispatch so composition roots can supply `Arc<dyn ...>`.
#[async_trait]
pub trait DecisionService: Send + Sync + 'static {
    /// Evaluate for the exact authenticated originating user. The caller must
    /// authenticate this identity; it must not come from the request body.
    async fn decide(
        &self,
        owner: MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, DecisionError>;
}

/// Admission, capacity, and deadline policy around the metered classifier port.
pub struct DecisionServiceImpl<C> {
    classifier: Option<Arc<C>>,
    admission: Arc<dyn AiAdmissionService>,
    completions: Arc<Semaphore>,
}

impl<C: YesNoClassifier> DecisionServiceImpl<C> {
    /// Compose the use case. Without a configured classifier, decisions fail
    /// explicitly and never bypass admission with an alternate provider.
    pub fn new(classifier: Option<C>, admission: Arc<dyn AiAdmissionService>) -> Self {
        Self {
            classifier: classifier.map(Arc::new),
            admission,
            completions: Arc::new(Semaphore::new(MAX_CONCURRENT_DECISIONS)),
        }
    }
}

#[async_trait]
impl<C: YesNoClassifier> DecisionService for DecisionServiceImpl<C> {
    #[tracing::instrument(name = "jev.decide", skip_all, fields(question_count = request.questions.len()), err)]
    async fn decide(
        &self,
        owner: MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, DecisionError> {
        let deadline = Instant::now() + DECISION_TIMEOUT;
        let (names, questions) = request.validated_questions()?;
        let classifier = self.classifier.clone().ok_or(DecisionError::Unavailable)?;
        let permit = self
            .completions
            .clone()
            .try_acquire_owned()
            .map_err(|_| DecisionError::Busy)?;
        tokio::time::timeout_at(
            deadline,
            self.admission
                .admit(&owner, AiFeature::DynamicCompletionsApi),
        )
        .await
        .map_err(|_| DecisionError::Timeout)??;

        // Dropping the caller's future detaches this bounded task. Keep both
        // its permit and metering alive until the admitted provider finishes.
        tokio::spawn(
            async move {
                let _permit = permit;
                let probabilities = tokio::time::timeout_at(
                    deadline,
                    classifier.classify(
                        UsageContext::new(AiFeature::DynamicCompletionsApi, owner),
                        &request.input,
                        &questions,
                    ),
                )
                .await
                .map_err(|_| DecisionError::Timeout)??;
                if probabilities.len() != names.len() {
                    return Err(DecisionError::Provider(JevError::InvalidResponse));
                }
                Ok(DecisionResponse {
                    probabilities: names
                        .into_iter()
                        .zip(
                            probabilities
                                .into_iter()
                                .map(|probability| probability.get()),
                        )
                        .collect(),
                })
            }
            .instrument(tracing::Span::current()),
        )
        .await
        .map_err(|_| DecisionError::Failed)?
    }
}
