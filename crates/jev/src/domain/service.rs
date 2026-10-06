//! The metered classification use case.

use std::sync::Arc;

use ai_usage::{UsageContext, UsageRecorder};
use serde_json::Value;

use super::{
    models::{JevError, MAX_QUESTIONS, Probability, YesNoQuestion},
    ports::{JevProvider, YesNoClassifier},
};

#[cfg(test)]
mod test;

/// Classifies through a [`JevProvider`] and records each round trip's tokens.
pub struct JevClassifier<P> {
    provider: P,
    recorder: Arc<dyn UsageRecorder>,
}

impl<P: JevProvider> JevClassifier<P> {
    /// Build a classifier that meters usage through `recorder`.
    pub fn new(provider: P, recorder: Arc<dyn UsageRecorder>) -> Self {
        Self { provider, recorder }
    }
}

impl<P: JevProvider> YesNoClassifier for JevClassifier<P> {
    #[tracing::instrument(name = "jev.classify", skip_all, err, fields(
        jev.questions = questions.len(),
        ai.feature = ?usage.feature,
    ))]
    async fn classify(
        &self,
        usage: UsageContext,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> Result<Vec<Probability>, JevError> {
        if questions.is_empty() {
            return Err(JevError::NoQuestions);
        }
        if questions.len() > MAX_QUESTIONS {
            return Err(JevError::TooManyQuestions);
        }
        let evaluation = self.provider.evaluate(input, questions).await?;
        // The provider billed the call even if its answers are unusable.
        self.recorder.record(usage.into_event(
            self.provider.model_id().to_owned(),
            evaluation.input_tokens,
            evaluation.output_tokens,
        ));
        if evaluation.probabilities.len() != questions.len() {
            return Err(JevError::InvalidResponse);
        }
        Ok(evaluation.probabilities)
    }
}
