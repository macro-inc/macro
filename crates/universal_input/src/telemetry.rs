use crate::domain::InputError;

// Build-generated content hash, not runtime configuration or a caller-supplied label.
pub(crate) const PROMPT_VERSION: &str = env!("UNIVERSAL_INPUT_PROMPT_VERSION");
pub(crate) const RECIPE_VERSION: &str = env!("UNIVERSAL_INPUT_RECIPE_VERSION");

pub(crate) enum ExtractionFailure {
    Timeout,
    Transport,
    HttpStatus,
    InvalidEnvelope,
    ProviderRejected,
    Truncated,
    MissingField,
    InvalidField,
    Uncertain,
    Ungrounded,
    IncompleteBody,
    OverlappingFields,
}

impl ExtractionFailure {
    fn label(&self) -> &'static str {
        match self {
            Self::Timeout => "timeout",
            Self::Transport => "transport",
            Self::HttpStatus => "http_status",
            Self::InvalidEnvelope => "invalid_envelope",
            Self::ProviderRejected => "provider_rejected",
            Self::Truncated => "truncated",
            Self::MissingField => "missing_field",
            Self::InvalidField => "invalid_field",
            Self::Uncertain => "uncertain",
            Self::Ungrounded => "ungrounded",
            Self::IncompleteBody => "incomplete_body",
            Self::OverlappingFields => "overlapping_fields",
        }
    }
}

pub(crate) fn extraction_failure(reason: ExtractionFailure) -> InputError {
    tracing::Span::current().record("input.failure", reason.label());
    InputError::Extraction
}
