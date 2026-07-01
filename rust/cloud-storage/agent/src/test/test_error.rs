use crate::error::*;
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

/// Assert that `err` unwraps to a [`CompletionError::ProviderError`] carrying
/// `msg`. Keeps the nesting tests below to one line each.
fn assert_provider_error(err: &AgentError, msg: &str) {
    match err.completion_error() {
        Some(CompletionError::ProviderError(got)) => assert_eq!(got, msg),
        other => panic!("expected a wrapped ProviderError, got {other:?}"),
    }
}

#[test]
fn completion_error_unwraps_direct_completion() {
    let err = AgentError::Completion(CompletionError::ProviderError("boom".to_string()));
    assert_provider_error(&err, "boom");
}

#[test]
fn completion_error_unwraps_prompt_completion() {
    let err = AgentError::Prompt(PromptError::CompletionError(
        CompletionError::ProviderError("boom".to_string()),
    ));
    assert_provider_error(&err, "boom");
}

#[test]
fn completion_error_unwraps_streaming_completion() {
    let err = AgentError::Streaming(StreamingError::Completion(CompletionError::ProviderError(
        "boom".to_string(),
    )));
    assert_provider_error(&err, "boom");
}

#[test]
fn completion_error_unwraps_streaming_prompt_completion() {
    // The real chat path surfaces provider failures as
    // `Streaming(Prompt(CompletionError))` — the deepest nesting.
    let err = AgentError::Streaming(StreamingError::Prompt(Box::new(
        PromptError::CompletionError(CompletionError::ProviderError("boom".to_string())),
    )));
    assert_provider_error(&err, "boom");
}

#[test]
fn completion_error_is_none_for_cancellation() {
    // A cancellation is not a completion failure.
    let err = AgentError::Prompt(prompt_cancelled());
    assert!(err.completion_error().is_none());
}

#[test]
fn completion_error_is_none_for_non_completion_errors() {
    let err = AgentError::UnknownModel("foo/bar".to_string());
    assert!(err.completion_error().is_none());

    let json_err = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
    let err = AgentError::Json(json_err);
    assert!(err.completion_error().is_none());
}
