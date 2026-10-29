//! The Focus classifier port, backed by Jev and metered as email focus usage.

use ai_usage::{AiFeature, UsageContext};
use email::domain::focus::{FocusClassifier, FocusClassifierError};
use jev::domain::{JevClassifier, JevProvider, Probability, YesNoClassifier, YesNoQuestion};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use uuid::Uuid;

/// Model id recorded with each classification; Jev's own name for its latest model.
const MODEL: &str = "jev-latest";

/// Jev answering Focus questions on the owner's behalf.
pub struct JevFocusClassifier<P> {
    classifier: JevClassifier<P>,
}

impl<P> JevFocusClassifier<P> {
    /// Classify through `classifier`, which records usage per call.
    pub fn new(classifier: JevClassifier<P>) -> Self {
        Self { classifier }
    }
}

impl<P: JevProvider> FocusClassifier for JevFocusClassifier<P> {
    async fn answer(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_id: Uuid,
        input: &Value,
        questions: &[&'static str],
    ) -> Result<Vec<f32>, FocusClassifierError> {
        let questions = questions
            .iter()
            .map(|question| YesNoQuestion::try_from(*question))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                tracing::error!(error = ?error, "invalid focus question");
                FocusClassifierError::Rejected
            })?;
        let usage =
            UsageContext::new(AiFeature::EmailFocus, owner.clone()).with_entity(Some(thread_id));
        match self.classifier.classify(usage, input, &questions).await {
            Ok(probabilities) => Ok(probabilities.into_iter().map(Probability::get).collect()),
            Err(error) if error.is_transient() => Err(FocusClassifierError::Unavailable),
            Err(_) => Err(FocusClassifierError::Rejected),
        }
    }

    fn model(&self) -> &'static str {
        MODEL
    }
}
