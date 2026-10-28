//! Model-selected temporal expressions resolved against the caller's clock in Rust.
mod models;
mod resolve;
pub use models::*;

use super::{ExtractInputRequest, FieldExtractor, InputError, InputIntent, InputSuggestions};
use ai_usage::UsageContext;
use std::future::Future;

/// Extract scheduling facts without calculating dates, defaults or end timestamps.
pub trait TemporalExtractor: Send + Sync {
    /// Extract only explicit temporal facts for the selected task/calendar destination.
    fn extract_temporal(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> impl Future<Output = Result<TemporalExpressions, InputError>> + Send;
}

/// Enrich ordinary field extraction with independently extracted temporal facts.
pub struct WithTemporalExtraction<F, T> {
    fields: F,
    temporal: T,
}

impl<F, T> WithTemporalExtraction<F, T> {
    /// Compose ports; provider selection remains the host's responsibility.
    pub fn new(fields: F, temporal: T) -> Self {
        Self { fields, temporal }
    }
}

impl<F: FieldExtractor, T: TemporalExtractor> FieldExtractor for WithTemporalExtraction<F, T> {
    #[tracing::instrument(name = "universal_input.fields_and_temporal", skip_all, err)]
    async fn extract(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        if !matches!(input.intent, InputIntent::Task | InputIntent::Calendar) {
            return self.fields.extract(input, usage).await;
        }
        let (mut suggestions, expressions) = futures::try_join!(
            self.fields.extract(input, usage.clone()),
            self.temporal.extract_temporal(input, usage),
        )?;
        resolve::apply(&mut suggestions, expressions, input)?;
        Ok(suggestions)
    }
}

#[cfg(test)]
mod test;
