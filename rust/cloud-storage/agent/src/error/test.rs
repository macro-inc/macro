use super::*;
use rig_core::agent::StreamingError;
use rig_core::completion::{CompletionError, PromptError};

fn prompt_cancelled() -> PromptError {
    PromptError::PromptCancelled {
        chat_history: Vec::new(),
        reason: "user cancelled".to_string(),
    }
}

#[test]
fn streaming_wrapped_cancellation_is_detected() {
    // The agent loop streams its errors, so a user cancellation reaches callers
    // wrapped as `Streaming(Prompt(PromptCancelled { .. }))` — not the bare
    // `Prompt` variant. This is the shape DCS actually sees.
    let err = AgentError::Streaming(StreamingError::Prompt(Box::new(prompt_cancelled())));
    assert!(err.was_cancelled());
}

#[test]
fn direct_prompt_cancellation_is_detected() {
    let err = AgentError::Prompt(prompt_cancelled());
    assert!(err.was_cancelled());
}

#[test]
fn non_cancellation_streaming_error_is_not_cancelled() {
    let err = AgentError::Streaming(StreamingError::Completion(CompletionError::ProviderError(
        "boom".to_string(),
    )));
    assert!(!err.was_cancelled());
}

#[test]
fn unrelated_error_is_not_cancelled() {
    let err = AgentError::UnknownModel("foo/bar".to_string());
    assert!(!err.was_cancelled());
}

#[test]
fn anthropic_500_body_is_provider_outage() {
    // What rig hands us for a 5xx: the raw provider body wrapped in ProviderError.
    let err = AgentError::Completion(CompletionError::ProviderError(
        r#"{"type":"error","error":{"type":"api_error","message":"Internal server error"}}"#
            .to_string(),
    ));
    assert_eq!(err.failure_kind(), FailureKind::ProviderOutage);
}

#[test]
fn overloaded_is_provider_outage() {
    let err = AgentError::Completion(CompletionError::ProviderError(
        r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#
            .to_string(),
    ));
    assert_eq!(err.failure_kind(), FailureKind::ProviderOutage);
}

#[test]
fn anthropic_prompt_too_long_is_context_overflow() {
    let err = AgentError::Completion(CompletionError::ProviderError(
        "prompt is too long: 250000 tokens > 200000 maximum".to_string(),
    ));
    assert_eq!(err.failure_kind(), FailureKind::ContextOverflow);
}

#[test]
fn openai_context_length_is_context_overflow() {
    let err = AgentError::Completion(CompletionError::ProviderError(
        "context_length_exceeded: maximum context length exceeded".to_string(),
    ));
    assert_eq!(err.failure_kind(), FailureKind::ContextOverflow);
}

#[test]
fn provider_error_through_streaming_prompt_is_classified() {
    // The real chat path surfaces errors as Streaming(Prompt(CompletionError)).
    let err = AgentError::Streaming(StreamingError::Prompt(Box::new(
        PromptError::CompletionError(CompletionError::ProviderError(
            "Service Unavailable".to_string(),
        )),
    )));
    assert_eq!(err.failure_kind(), FailureKind::ProviderOutage);
}

#[test]
fn json_error_is_internal() {
    let json_err = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
    let err = AgentError::Json(json_err);
    assert_eq!(err.failure_kind(), FailureKind::Internal);
}

#[test]
fn unknown_model_is_internal() {
    let err = AgentError::UnknownModel("bogus".to_string());
    assert_eq!(err.failure_kind(), FailureKind::Internal);
}
