//! Ports: the use case exposed to callers and the capability it needs.

use std::future::Future;

use ai_usage::UsageContext;
use serde_json::Value;

use super::models::{Evaluation, JevError, Probability, YesNoQuestion};

/// External yes/no evaluation, implemented by outbound adapters.
pub trait JevProvider: Send + Sync + 'static {
    /// Model identifier used by the shared pricing and usage recorder.
    fn model_id(&self) -> &'static str;

    /// Ask every question about `input` in one round trip. Answers come back
    /// in question order, one per question.
    fn evaluate(
        &self,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> impl Future<Output = Result<Evaluation, JevError>> + Send;
}

/// Yes/no classification of any JSON input, metered as AI usage.
pub trait YesNoClassifier: Send + Sync + 'static {
    /// The probability that each question is true of `input`, in question
    /// order. Token usage is recorded against `usage`.
    fn classify(
        &self,
        usage: UsageContext,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> impl Future<Output = Result<Vec<Probability>, JevError>> + Send;
}
