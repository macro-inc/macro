use super::*;

/// Build the [`StreamError`] DCS would send for `error`, with fixed ids.
fn classify(error: &AgentError) -> StreamError {
    StreamError::from(AgentStreamFailure {
        error,
        stream_id: "stream-1",
        model: "anthropic/claude-opus-4-8",
    })
}

#[test]
fn anthropic_500_body_is_provider_error() {
    // What rig hands us for a 5xx: the raw provider body wrapped in ProviderError.
    let err = AgentError::Completion(CompletionError::ProviderError(
        r#"{"type":"error","error":{"type":"api_error","message":"Internal server error"}}"#
            .to_string(),
    ));
    assert!(matches!(
        classify(&err),
        StreamError::ProviderError { model, .. } if model == "anthropic/claude-opus-4-8"
    ));
}

#[test]
fn overloaded_is_provider_error() {
    let err = AgentError::Completion(CompletionError::ProviderError(
        r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#
            .to_string(),
    ));
    assert!(matches!(classify(&err), StreamError::ProviderError { .. }));
}

#[test]
fn anthropic_prompt_too_long_is_context_overflow() {
    let err = AgentError::Completion(CompletionError::ProviderError(
        "prompt is too long: 250000 tokens > 200000 maximum".to_string(),
    ));
    assert!(matches!(
        classify(&err),
        StreamError::ModelContextOverflow { .. }
    ));
}

#[test]
fn openai_context_length_is_context_overflow() {
    let err = AgentError::Completion(CompletionError::ResponseError(
        "context_length_exceeded: maximum context length exceeded".to_string(),
    ));
    assert!(matches!(
        classify(&err),
        StreamError::ModelContextOverflow { .. }
    ));
}

#[test]
fn non_completion_error_is_internal() {
    let err = AgentError::UnknownModel("bogus".to_string());
    assert!(matches!(classify(&err), StreamError::InternalError { .. }));
}

#[test]
fn json_error_is_internal() {
    let json_err = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
    let err = AgentError::Json(json_err);
    assert!(matches!(classify(&err), StreamError::InternalError { .. }));
}

#[test]
fn stream_id_is_propagated() {
    let err = AgentError::UnknownModel("bogus".to_string());
    let StreamError::InternalError { stream_id } = classify(&err) else {
        panic!("expected internal error");
    };
    assert_eq!(stream_id, "stream-1");
}
