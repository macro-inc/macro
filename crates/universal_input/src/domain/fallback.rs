//! Extraction failover policy, independent of provider implementations.
use super::{ExtractInputRequest, FieldExtractor, InputError, InputIntent, InputSuggestions};
use ai_usage::UsageContext;
use std::future::Future;

#[cfg(test)]
mod test;

/// Try an optional primary extractor, retaining an existing provider as fallback.
pub struct FallbackFieldExtractor<P, F> {
    primary: Option<P>,
    fallback: F,
}

impl<P, F> FallbackFieldExtractor<P, F> {
    /// An unconfigured primary uses only the fallback; failed inference falls back once.
    pub fn new(primary: Option<P>, fallback: F) -> Self {
        Self { primary, fallback }
    }
}

impl<P: FieldExtractor, F: FieldExtractor> FieldExtractor for FallbackFieldExtractor<P, F> {
    async fn extract(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        attempt(
            self.primary
                .as_ref()
                .map(|primary| primary.extract(input, usage.clone())),
            self.fallback.extract(input, usage),
            input.intent,
            ExtractionStage::Content,
        )
        .await
    }
}

impl<P: super::search::SearchExtractor, F: super::search::SearchExtractor>
    super::search::SearchExtractor for FallbackFieldExtractor<P, F>
{
    async fn select_search_type(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<super::search::SearchType, InputError> {
        attempt(
            self.primary
                .as_ref()
                .map(|primary| primary.select_search_type(input, usage.clone())),
            self.fallback.select_search_type(input, usage),
            input.intent,
            ExtractionStage::SearchType,
        )
        .await
    }
    async fn extract_search(
        &self,
        input: &ExtractInputRequest,
        search_type: super::search::SearchType,
        usage: UsageContext,
    ) -> Result<super::search::SearchSuggestions, InputError> {
        attempt(
            self.primary
                .as_ref()
                .map(|primary| primary.extract_search(input, search_type, usage.clone())),
            self.fallback.extract_search(input, search_type, usage),
            input.intent,
            ExtractionStage::SearchFields,
        )
        .await
    }
}

enum ExtractionStage {
    Content,
    SearchType,
    SearchFields,
}
impl ExtractionStage {
    fn name(&self) -> &'static str {
        match self {
            Self::Content => "content",
            Self::SearchType => "search_type",
            Self::SearchFields => "search_fields",
        }
    }
}

#[tracing::instrument(name = "universal_input.failover", skip_all, err, fields(
    input.primary_configured = primary.is_some(),
    input.intent = intent.telemetry_name(),
    input.phase = stage.name(),
    input.fallback_used = false,
    input.fallback_reason = tracing::field::Empty,
    input.provider_path = tracing::field::Empty,
    input.fallback_succeeded = tracing::field::Empty,
    input.prompt_version = crate::telemetry::PROMPT_VERSION,
    input.recipe_version = crate::telemetry::RECIPE_VERSION,
))]
async fn attempt<T>(
    primary: Option<impl Future<Output = Result<T, InputError>>>,
    fallback: impl Future<Output = Result<T, InputError>>,
    intent: InputIntent,
    stage: ExtractionStage,
) -> Result<T, InputError> {
    let span = tracing::Span::current();
    if let Some(primary) = primary {
        match primary.await {
            Ok(value) => {
                span.record("input.provider_path", "primary");
                return Ok(value);
            }
            Err(error @ (InputError::Extraction | InputError::Unavailable)) => {
                span.record("input.fallback_used", true);
                span.record("input.fallback_reason", error.telemetry_kind());
                span.record("input.provider_path", "fallback");
                tracing::warn!(
                    failure = error.telemetry_kind(),
                    "Universal Input using fallback"
                );
            }
            Err(error) => return Err(error),
        }
    } else {
        span.record("input.provider_path", "fallback_only");
    }
    let result = fallback.await;
    span.record("input.fallback_succeeded", result.is_ok());
    result
}
