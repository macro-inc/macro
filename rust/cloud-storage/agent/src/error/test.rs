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
